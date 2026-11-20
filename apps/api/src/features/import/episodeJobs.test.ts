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
import { episodeImportJobRepository } from "./repository";

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
function workflowStub(opts?: {
  instanceStatus?: string;
  error?: string;
  // インスタンス ID ごとの状態。未登録の ID は missing に含めば
  // instance.not_found で落ち、そうでなければ instanceStatus を返す。
  statuses?: Record<string, { status: string; error?: string }>;
  missing?: string[];
}) {
  const created: { id?: string; params?: unknown }[] = [];
  const queried: string[] = [];
  return {
    created,
    queried,
    stub: {
      create: vi.fn(async (o?: { id?: string; params?: unknown }) => {
        created.push(o ?? {});
        return { id: o?.id ?? "inst" };
      }),
      get: vi.fn(async (id: string) => {
        if (opts?.missing?.includes(id)) {
          throw new Error("instance.not_found");
        }
        return {
          status: async () => {
            queried.push(id);
            const s = opts?.statuses?.[id];
            return {
              status: s?.status ?? opts?.instanceStatus ?? "running",
              error: s?.error
                ? { name: "Error", message: s.error }
                : opts?.error
                  ? { name: "Error", message: opts.error }
                  : undefined,
            };
          },
        };
      }),
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
    // workflowInstanceId 未設定の旧ジョブは初回インスタンス（job.id）しか
    // 見えないため、complete でも引き継ぎ中かもしれず緩く扱う。
    await db
      .update(danimeEpisodeImportJobs)
      .set({ status: "writing", workflowInstanceId: null })
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
    // workflowInstanceId 未設定の旧ジョブは引き継ぎ先が見えないため緩く扱う。
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
      .set({ workflowInstanceId: null })
      .where(eq(danimeEpisodeImportJobs.id, job.id));

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

  it("記録された引き継ぎ先インスタンスが errored なら、その ID を見て failed に追従する", async () => {
    // issue #701: 引き継ぎ先は job.id とは別 ID で起動するため、
    // job.id の初回インスタンスが complete でも、記録された最新
    // インスタンスが止まっていれば failed にする。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "running" });
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
    const handoffId = `${job.id}-h1`;
    await db
      .update(danimeEpisodeImportJobs)
      .set({ workflowInstanceId: handoffId })
      .where(eq(danimeEpisodeImportJobs.id, job.id));
    // 初回インスタンスは complete、引き継ぎ先が errored。
    wf.stub.get.mockImplementation(async (id: string) => ({
      status: async () =>
        id === handoffId
          ? { status: "errored", error: { name: "Error", message: "boom" } }
          : { status: "complete", error: undefined },
    }));

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
    // 初回インスタンスではなく記録された引き継ぎ先を見ている
    expect(wf.stub.get).toHaveBeenCalledWith(handoffId);
  });

  it("追跡対象のインスタンスが後続を残さず complete した実行中ジョブは failed に追従する", async () => {
    // issue #701: workflowInstanceId が指すインスタンスは常に最新の
    // 実行主体のはずなので、それが完了したのにジョブが matching の
    // ままなら行き止まり（引き継ぎ記録が失われた異常系）。
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
    expect(body.job.status).toBe("failed");
  });

  it("記録されたインスタンスが存在しないまま古いジョブは failed に追従し、記録直後は起動中とみなす", async () => {
    // issue #701: 引き継ぎは create の前に次インスタンス ID を記録する。
    // 記録直後の「ID はあるがインスタンスが無い」は起動中で、
    // 古いまま存在しないのは create 失敗による停滞。
    await seedUserAndToken(db);
    const { app, bindings } = buildApp(workflowStub().stub);

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
    const goneId = `${job.id}-h1`;
    const wf = workflowStub({ missing: [goneId] });
    const app2 = applyApiErrorHandling(new Hono<TestEnv>());
    app2.route("/me/import", importRoute);
    const bindings2 = { ...bindings, DANIME_EPISODE_IMPORT: wf.stub };

    // 記録直後（updatedAt が新しい）は起動中とみなして matching のまま
    await db
      .update(danimeEpisodeImportJobs)
      .set({ workflowInstanceId: goneId, updatedAt: new Date() })
      .where(eq(danimeEpisodeImportJobs.id, job.id));
    const fresh = await app2.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings2,
    );
    const freshBody = (await fresh.json()) as { job: { status: string } };
    expect(freshBody.job.status).toBe("matching");

    // 記録が古いままインスタンスが存在しないジョブは failed
    await db
      .update(danimeEpisodeImportJobs)
      .set({ updatedAt: new Date(Date.now() - 120_000) })
      .where(eq(danimeEpisodeImportJobs.id, job.id));
    const res = await app2.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings2,
    );
    const body = (await res.json()) as { job: { status: string } };
    expect(body.job.status).toBe("failed");
  });

  it("追跡列のない旧ジョブは、インスタンスが errored で最終活動が古いと failed にする", async () => {
    // issue #701 の本番ジョブ相当: workflow_instance_id 列が無い時代に
    // 作られたジョブは追跡先を持たず初回インスタンス（job.id）しか
    // 見えないが、最終活動が古ければ見えない後続も止まっているとみなす。
    // これで matching,total=0 のまま残ったジョブが進捗参照で自動的に
    // failed になる。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "errored", error: "boom" });
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
    // 旧ジョブ相当にする（追跡列なし・最終活動は 20 分前）
    await db
      .update(danimeEpisodeImportJobs)
      .set({
        workflowInstanceId: null,
        updatedAt: new Date(Date.now() - 20 * 60_000),
      })
      .where(eq(danimeEpisodeImportJobs.id, job.id));

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

  it("追跡列のない旧ジョブは、初回インスタンスが complete で最終活動が古いと failed にする", async () => {
    // CodeRabbit #702: 追跡列のない旧ジョブでは初回インスタンスの
    // complete しか見えず、自動採番の引き継ぎ先が errored でも
    // 見つけられない。後続が生きていればアイテム・ジョブ行が定期的に
    // 更新されるため、最終活動が古いなら後続は止まっているとみなす。
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
      .set({
        workflowInstanceId: null,
        updatedAt: new Date(Date.now() - 20 * 60_000),
      })
      .where(eq(danimeEpisodeImportJobs.id, job.id));

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as { job: { status: string } };
    expect(body.job.status).toBe("failed");
  });

  it("照合の隙間に追跡先が次インスタンスへ進んだ場合、旧インスタンスの complete では failed にしない", async () => {
    // Devin Review #702: 進捗照合は「ジョブ行を読む → インスタンス状態を
    // 取る」の順なので、その隙間に引き継ぎが進むと、正常終了した
    // 引き継ぎ元（complete）を見て生きているジョブを failed にしてしまう。
    // 終了への書き換えは記録中のインスタンス ID と一致するときだけ行う。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "running" });
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
    const nextId = `${job.id}-h1`;
    // 照合がインスタンス状態を取る直前に、引き継ぎ側が追跡先を
    // 次インスタンスへ書き換えた状態を再現する。
    wf.stub.get.mockImplementation(async () => {
      await db
        .update(danimeEpisodeImportJobs)
        .set({ workflowInstanceId: nextId })
        .where(eq(danimeEpisodeImportJobs.id, job.id));
      return {
        status: async () => ({ status: "complete", error: undefined }),
      };
    });

    const res = await app.request(
      "/me/import/danime/episode-jobs/current",
      {},
      bindings,
    );
    const body = (await res.json()) as { job: { status: string } };
    // 旧インスタンスの complete を見ても failed にならない
    expect(body.job.status).toBe("matching");
    const row = await db.query.danimeEpisodeImportJobs.findFirst({
      where: eq(danimeEpisodeImportJobs.id, job.id),
    });
    expect(row?.status).toBe("matching");
    expect(row?.workflowInstanceId).toBe(nextId);
  });

  it("引き継ぎ先の記録は引き継ぎ元が記録中のときだけ行い、巻き戻さない", async () => {
    // Devin Review #702: ハンドオフステップがリトライで再実行されると、
    // すでに先へ進んだ記録を古いインスタンスへ巻き戻し得る。
    // 記録は「現在値が引き継ぎ元の ID」のときだけ更新する。
    await seedUserAndToken(db);
    const repo = episodeImportJobRepository(db);
    const { app, bindings } = buildApp(workflowStub().stub);
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
    const recorded = async () =>
      (
        await db.query.danimeEpisodeImportJobs.findFirst({
          where: eq(danimeEpisodeImportJobs.id, job.id),
        })
      )?.workflowInstanceId;

    // h1 が記録中なら、h1 からの引き継ぎ（→h2）は記録できる
    await db
      .update(danimeEpisodeImportJobs)
      .set({ workflowInstanceId: `${job.id}-h1` })
      .where(eq(danimeEpisodeImportJobs.id, job.id));
    await repo.setJobInstanceId(job.id, `${job.id}-h2`, `${job.id}-h1`);
    expect(await recorded()).toBe(`${job.id}-h2`);

    // h2 がさらに h3 へ引き継ぐと記録は h3 に進む
    await repo.setJobInstanceId(job.id, `${job.id}-h3`, `${job.id}-h2`);
    expect(await recorded()).toBe(`${job.id}-h3`);

    // h1 のハンドオフステップがリトライで再実行されても、
    // 記録値はすでに引き継ぎ元（h1）ではないため h2 へ巻き戻らない
    await repo.setJobInstanceId(job.id, `${job.id}-h2`, `${job.id}-h1`);
    expect(await recorded()).toBe(`${job.id}-h3`);
  });

  it("実行中ジョブのインスタンスが止まっているとき、POST はそのジョブを終了させて新規作成する", async () => {
    // issue #701: D1 上限で止まったジョブが matching のまま残ると
    // 部分一意インデックスで以後の POST が既存ジョブを返し続け、
    // ユーザーが取り込みをやり直せなくなる。POST でも照合して
    // 止まっているジョブを終了させる。
    await seedUserAndToken(db);
    const wf = workflowStub({ instanceStatus: "errored", error: "boom" });
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
    const firstBody = (await first.json()) as {
      job: { id: string; status: string };
    };
    expect(firstBody.job.status).toBe("matching");

    const second = await app.request(
      "/me/import/danime/episode-jobs",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(WORKS_BODY),
      },
      bindings,
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      created: boolean;
      job: { id: string; status: string };
    };
    // 止まっていたジョブは failed に倒され、新しいジョブが作られる
    expect(secondBody.created).toBe(true);
    expect(secondBody.job.id).not.toBe(firstBody.job.id);
    const old = await db.query.danimeEpisodeImportJobs.findFirst({
      where: eq(danimeEpisodeImportJobs.id, firstBody.job.id),
    });
    expect(old?.status).toBe("failed");
    expect(old?.error).toBe("boom");
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
