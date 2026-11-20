// dアニメ話記録ジョブの登録・進捗参照ルートのテスト（issue #477）。
// Workflow バインディングはスタブに差し替え、インスタンス起動が
// 呼ばれること・D1 のジョブ行が作られること・実行中の二重作成を
// 拒否することを検証する。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { importRoute } from "@/features/import";
import { eq } from "drizzle-orm";
import {
  users,
  annictTokens,
  danimeEpisodeImportItems,
  danimeEpisodeImportJobs,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_epjob01";
const JSON_HEADERS = { "Content-Type": "application/json" };

// Workflow バインディングのスタブ。create はインスタンス起動を記録するだけ。
function workflowStub(opts?: { instanceStatus?: string; error?: string }) {
  const created: { id?: string; params?: unknown }[] = [];
  return {
    created,
    stub: {
      create: vi.fn(async (o?: { id?: string; params?: unknown }) => {
        created.push(o ?? {});
        return { id: o?.id ?? "inst" };
      }),
      get: vi.fn(async () => ({
        status: async () => ({
          status: opts?.instanceStatus ?? "running",
          error: opts?.error
            ? { name: "Error", message: opts.error }
            : undefined,
        }),
      })),
    },
  };
}

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    DANIME_EPISODE_IMPORT?: unknown;
  };
  Variables: { clerkUserId: string };
};

function buildApp(workflow?: unknown) {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/import", importRoute);
  const bindings = {
    DB: env.DB,
    CLERK_SECRET_KEY: "test_secret",
    CLERK_PUBLISHABLE_KEY: "test_pub",
    ...(workflow ? { DANIME_EPISODE_IMPORT: workflow } : {}),
  };
  return { app, bindings };
}

const WORKS_BODY = {
  works: [
    {
      danimeWorkId: "1001",
      annictWorkId: 555,
      episodes: [
        { partId: "0001", watched: true, label: "第1話", subtitle: "サブ" },
        { partId: "0002", watched: false, label: "第2話", subtitle: "" },
      ],
    },
  ],
};

async function seedUserAndToken(db: Awaited<ReturnType<typeof setupTestDb>>) {
  const now = new Date();
  await db.insert(users).values({
    id: USER_ID,
    username: "epjob",
    createdAt: now,
    updatedAt: now,
  });
  // トークン行の存在確認だけなので中身は復号可能である必要がない。
  await db.insert(annictTokens).values({
    userId: USER_ID,
    encryptedToken: "enc",
    createdAt: now,
    updatedAt: now,
  });
}

describe("dアニメ話記録ジョブ API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as ReturnType<typeof getAuth>);
  });

  it("認証なしは 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const { app, bindings } = buildApp(workflowStub().stub);
    const res = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(res.status).toBe(401);
  });

  it("D1 に Annict トークンが無いユーザーは 401（Workflow が復号できないため）", async () => {
    await db.insert(users).values({
      id: USER_ID,
      username: "epjob",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app, bindings } = buildApp(workflowStub().stub);
    const res = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "annict_token_required",
    });
  });

  it("ジョブを作成して Workflow インスタンスを起動し、即座に返す", async () => {
    await seedUserAndToken(db);
    const wf = workflowStub();
    const { app, bindings } = buildApp(wf.stub);

    const res = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      created: boolean;
      job: { id: string; status: string; total: number };
    };
    expect(body.created).toBe(true);
    expect(body.job.status).toBe("matching");
    // Workflow には平文トークンを載せず、識別子だけを渡す。
    expect(wf.created).toHaveLength(1);
    expect(wf.created[0]!.id).toBe(body.job.id);
    expect(wf.created[0]!.params).toEqual({
      jobId: body.job.id,
      userId: USER_ID,
    });
    expect(JSON.stringify(wf.created[0]!.params)).not.toContain("annict");
  });

  it("実行中ジョブがあるときは新規作成せず既存を返す", async () => {
    await seedUserAndToken(db);
    const wf = workflowStub();
    const { app, bindings } = buildApp(wf.stub);

    const first = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    const firstJob = (await first.json()) as { job: { id: string } };

    const second = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      created: boolean;
      job: { id: string };
    };
    expect(body.created).toBe(false);
    expect(body.job.id).toBe(firstJob.job.id);
    expect(wf.created).toHaveLength(1);
  });

  it("Workflow バインディングが無い環境では 503", async () => {
    await seedUserAndToken(db);
    const { app, bindings } = buildApp(undefined);
    const res = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(res.status).toBe(503);
  });

  it("GET current はジョブが無ければ null、あれば進捗を返す", async () => {
    await seedUserAndToken(db);
    const wf = workflowStub();
    const { app, bindings } = buildApp(wf.stub);

    const empty = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    expect(await empty.json()).toEqual({ job: null });

    await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as {
      job: { status: string; total: number; done: number };
    };
    expect(body.job.status).toBe("matching");
    expect(body.job).toMatchObject({ total: 0, done: 0, failed: 0 });
  });

  it("インスタンスが complete でも、writing で pending が残るジョブは完了扱いしない", async () => {
    // issue #695: サブリクエスト予算の引き継ぎで元インスタンスは正常
    // 終了（complete）するが、後続インスタンスが残りの pending を
    // 処理中。ここで completed にすると引き継ぎ先の load-job が
    // 終了済み判定で止まり、残りの話が永久に書かれない。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "complete" });
    const { app, bindings } = buildApp(wf.stub);

    const created = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    const { job } = (await created.json()) as { job: { id: string } };
    // 引き継ぎ後の状態を再現（書き込み中・pending 残り）。
    await db
      .update(danimeEpisodeImportJobs)
      .set({ status: "writing" })
      .where(eq(danimeEpisodeImportJobs.id, job.id));
    await db.insert(danimeEpisodeImportItems).values({
      jobId: job.id,
      annictWorkId: 555,
      annictEpisodeId: 101,
      episodeNodeId: "Ep-101",
      status: "pending",
      updatedAt: new Date(),
    });

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as { job: { status: string } };
    expect(body.job.status).toBe("writing");
  });

  it("インスタンスが complete でも、matching のジョブは完了扱いしない", async () => {
    // 対応付け中の引き継ぎではアイテムがまだ 1 件も無い（pending=0）
    // ことがあるため、pending 0 だけでは完了と判定できない。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "complete" });
    const { app, bindings } = buildApp(wf.stub);

    await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as { job: { status: string } };
    expect(body.job.status).toBe("matching");
  });

  it("writing で pending が残っていなければインスタンスの complete に追従する", async () => {
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "complete" });
    const { app, bindings } = buildApp(wf.stub);

    const created = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    const { job } = (await created.json()) as { job: { id: string } };
    await db
      .update(danimeEpisodeImportJobs)
      .set({ status: "writing" })
      .where(eq(danimeEpisodeImportJobs.id, job.id));

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as { job: { status: string } };
    expect(body.job.status).toBe("completed");
  });

  it("実行中のままインスタンスが errored なら D1 側も failed に追従する", async () => {
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "errored", error: "boom" });
    const { app, bindings } = buildApp(wf.stub);

    await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as {
      job: { status: string; error: string | null };
    };
    expect(body.job.status).toBe("failed");
    expect(body.job.error).toBe("boom");
  });

  it("works が空のリクエストは 400", async () => {
    await seedUserAndToken(db);
    const { app, bindings } = buildApp(workflowStub().stub);
    const res = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ works: [] }),
      },
      bindings,
    );
    expect(res.status).toBe(400);
  });
});
