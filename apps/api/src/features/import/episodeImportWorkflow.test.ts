// dアニメ話記録 Workflow の E2E テスト（issue #477）。
// miniflare がバインドする実 Workflow クラスをインスタンスとして起動し、
// 「ジョブ登録 → 対応付け → 書き込み → 完了」が最後まで走ること、
// Annict 記録済みの話がスキップされること、再実行・引き継ぎで二重に
// 書かないことを検証する。Annict API は globalThis.fetch をスパイして
// 差し替えるため、本番 API には一切書き込まない。
//
// テストでは env オブジェクトへの代入が Workflow の this.env に届くことを
// 利用し、待ち時間（write interval / 429 wait / retry delay）を潰し、
// DANIME_WORKFLOW_STEP_BUDGET を小さくしてある。そのため小さいジョブでも
// 必ず複数インスタンスの引き継ぎを通る（＝引き継ぎが全テストで実働検証される）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import {
  annictTokens,
  annictWorks,
  danimeEpisodeImportItems,
  danimeEpisodeImportJobs,
  danimeEpisodeImportWorks,
  episodeRecords,
  users,
} from "@/db/schema";
import { encryptToken } from "@/lib/annict/crypto";
import type { DanimeEpisodeJobStatus } from "@/db/schema";

const USER_ID = "user_epwf01";
const ANNICT_WORK_ID = 555;
const PLAIN_TOKEN = "annict_test_token";
// テスト用の暗号鍵。実行ごとに生成し env に差し込む（固定値の埋め込みは
// シークレットスキャンの誤検知を招く）。.dev.vars の実鍵とは別物にして、
// env 上の値が Workflow 側に届くこと自体を検証する。
const TEST_ENC_KEY = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

type Db = Awaited<ReturnType<typeof setupTestDb>>;

async function seedUserAndToken(db: Db) {
  const now = new Date();
  await db.insert(users).values({
    id: USER_ID,
    username: "epwf",
    createdAt: now,
    updatedAt: now,
  });
  const encrypted = await encryptToken(PLAIN_TOKEN, TEST_ENC_KEY);
  await db.insert(annictTokens).values({
    userId: USER_ID,
    encryptedToken: encrypted,
    createdAt: now,
    updatedAt: now,
  });
  // episode_records の annict_works FK を満たす作品キャッシュ。
  // あれば ensureAnnictWork が Annict を叩かずに済む。
  await db.insert(annictWorks).values({
    annictWorkId: ANNICT_WORK_ID,
    title: "テスト作品",
    updatedAt: now,
  });
}

async function seedUserOnly(db: Db) {
  const now = new Date();
  await db.insert(users).values({
    id: USER_ID,
    username: "epwf",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedJob(
  db: Db,
  opts: { status?: DanimeEpisodeJobStatus; jobId?: string } = {},
) {
  const now = new Date();
  const jobId = opts.jobId ?? crypto.randomUUID();
  await db.insert(danimeEpisodeImportJobs).values({
    id: jobId,
    userId: USER_ID,
    status: opts.status ?? "matching",
    createdAt: now,
    updatedAt: now,
  });
  return jobId;
}

async function seedWork(
  db: Db,
  jobId: string,
  episodesJson: string,
  annictWorkId = ANNICT_WORK_ID,
) {
  await db.insert(danimeEpisodeImportWorks).values({
    jobId,
    danimeWorkId: "dwork-1",
    annictWorkId,
    episodesJson,
  });
}

async function getJob(db: Db, jobId: string) {
  return db.query.danimeEpisodeImportJobs.findFirst({
    where: eq(danimeEpisodeImportJobs.id, jobId),
  });
}

/** 引き継ぎで複数インスタンスに跨るため、D1 のジョブ状態が収まるまでポーリングする。 */
async function waitForJob(
  db: Db,
  jobId: string,
  statuses: string[],
  timeoutMs = 25_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJob(db, jobId);
    if (job && statuses.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  const job = await getJob(db, jobId);
  throw new Error(
    `job did not reach ${statuses.join("/")} (status=${job?.status}, error=${job?.error})`,
  );
}

// Annict GraphQL の POST ボディを種類別に振り分けるモック。
// query 文字列に含まれるフィールド名で判別する。
function installAnnictMock(opts?: {
  createRecord?: (
    call: { episodeId: string | undefined },
    index: number,
  ) => Response;
}) {
  const calls: { query: string; episodeId: string | undefined }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as {
            query?: string;
            variables?: { episodeId?: string };
          })
        : {};
    const q = body.query ?? "";
    const call = { query: q, episodeId: body.variables?.episodeId };
    calls.push(call);
    if (q.includes("createRecord")) {
      return (
        opts?.createRecord?.(call, calls.length - 1) ??
        jsonResponse({
          data: {
            createRecord: {
              record: {
                id: "Rec-1",
                annictId: 9001,
                createdAt: "2026-01-01T00:00:00Z",
              },
            },
          },
        })
      );
    }
    if (q.includes("episodes")) {
      return jsonResponse({
        data: {
          searchWorks: {
            nodes: [
              {
                annictId: ANNICT_WORK_ID,
                episodes: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "Ep-101",
                      annictId: 101,
                      number: 1,
                      numberText: "第1話",
                      sortNumber: 1,
                      title: "サブタイトル1",
                      viewerDidTrack: false,
                      viewerRecordsCount: 0,
                    },
                    {
                      id: "Ep-102",
                      annictId: 102,
                      number: 2,
                      numberText: "第2話",
                      sortNumber: 2,
                      title: "サブタイトル2",
                      // Annict 記録済み。書き込み対象から外れるべき話。
                      viewerDidTrack: true,
                      viewerRecordsCount: 1,
                    },
                  ],
                },
              },
            ],
          },
        },
      });
    }
    // annict_works キャッシュ済みなら作品メタ解決は来ないが、
    // 来ても 1 件だけ返す（ensureAnnictWork のフォールバック経路）。
    return jsonResponse({
      data: {
        searchWorks: {
          nodes: [
            {
              annictId: ANNICT_WORK_ID,
              id: "Work-555",
              title: "テスト作品",
              titleKana: null,
              titleEn: null,
              seasonName: null,
              seasonYear: null,
              watchersCount: null,
              malAnimeId: null,
              image: {
                internalUrl: null,
                recommendedImageUrl: null,
                facebookOgImageUrl: null,
                twitterBiggerAvatarUrl: null,
                twitterAvatarUrl: null,
                twitterNormalAvatarUrl: null,
                twitterMiniAvatarUrl: null,
              },
            },
          ],
        },
      },
    });
  });
  return calls;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// partId 連番・話数表記・サブタイトルの 3 方式が全部一致する確定話 2 件と、
// どの方式も根拠を持てない未確定話 1 件の入力。
const WORK_EPISODES_JSON = JSON.stringify([
  { partId: "0001", watched: true, label: "第1話", subtitle: "サブタイトル1" },
  { partId: "0002", watched: true, label: "第2話", subtitle: "サブタイトル2" },
  { partId: "0003", watched: true, label: "本編", subtitle: "" },
]);

describe("dアニメ話記録 Workflow（issue #477）", () => {
  let db: Db;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    // Workflow は this.env を共有するため、env オブジェクトへの代入は
    // Workflow 側にも届く。待ち時間・ステップ上限を潰して、実時間を
    // 待たずジョブを最後まで走らせ、小さいジョブでも引き継ぎを通す。
    // （.dev.vars が無い CI でも動くよう、暗号鍵もここで与える）
    env.ANNICT_ENCRYPTION_KEY = TEST_ENC_KEY;
    env.DANIME_WRITE_INTERVAL_MS = "0";
    env.DANIME_RATE_LIMIT_WAIT_MS = "1";
    env.DANIME_TRANSIENT_RETRY_WAIT_MS = "1";
    env.DANIME_WORKFLOW_STEP_BUDGET = "5";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("対応付け → 書き込み → 完了まで走り、記録済みの話はスキップされる", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    const calls = installAnnictMock();

    const inst = await introspectWorkflowInstance(
      env.DANIME_EPISODE_IMPORT,
      jobId,
    );
    await inst.modify(async (m) => {
      await m.disableRetryDelays();
    });
    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    // pending=1（未記録の 101）・skipped=1（記録済み 102）・未確定=1（本編）
    expect({
      total: job.total,
      done: job.done,
      failed: job.failed,
      skipped: job.skipped,
      unmatched: job.unmatched,
    }).toEqual({ total: 1, done: 1, failed: 0, skipped: 1, unmatched: 1 });

    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items).toHaveLength(2);
    const byEpisode = new Map(items.map((i) => [i.annictEpisodeId, i]));
    expect(byEpisode.get(101)?.status).toBe("done");
    expect(byEpisode.get(102)?.status).toBe("skipped");

    // createRecord は未記録の 101 にだけ飛ぶ
    const recordCalls = calls.filter((c) => c.query.includes("createRecord"));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]!.episodeId).toBe("Ep-101");

    // D1 の記録ログにも残る
    const logs = await db
      .select()
      .from(episodeRecords)
      .where(eq(episodeRecords.annictEpisodeId, 101));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.userId).toBe(USER_ID);
    await inst.dispose();
  });

  it("writing の途中から始まるジョブは pending だけを書き、done 済みを再送しない", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    // 前のインスタンスが 101 を書き終えて落ちた状態を再現する
    await db.insert(danimeEpisodeImportItems).values([
      {
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId: 101,
        episodeNodeId: "Ep-101",
        status: "done",
        updatedAt: now,
      },
      {
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId: 102,
        episodeNodeId: "Ep-102",
        status: "pending",
        updatedAt: now,
      },
    ]);
    const calls = installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");

    // 話一覧の対応付けフェーズは走らず、createRecord も pending の 1 件だけ
    expect(calls.filter((c) => c.query.includes("episodes"))).toHaveLength(0);
    const recordCalls = calls.filter((c) => c.query.includes("createRecord"));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]!.episodeId).toBe("Ep-102");
  });

  it("対応付けステップが 1 回落ちてもリトライで最後まで走る", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    installAnnictMock();

    const inst = await introspectWorkflowInstance(
      env.DANIME_EPISODE_IMPORT,
      jobId,
    );
    await inst.modify(async (m) => {
      await m.disableRetryDelays();
      // match-0 を 1 回だけ落として、ステップリトライが働くことを見る。
      await m.mockStepError({ name: "match-0" }, new Error("injected"), 1);
    });
    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    await inst.dispose();
  });

  it("完了済みジョブの再実行は何も書かない（二重起動の保険）", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "completed" });
    const calls = installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: `${jobId}-again`,
      params: { jobId, userId: USER_ID },
    });
    // 完了のまま変わらないことを確認（no-op で即終わる）
    await new Promise((r) => setTimeout(r, 1_500));
    expect(calls).toHaveLength(0);
    const job = await getJob(db, jobId);
    expect(job?.status).toBe("completed");
  });

  it("Annict トークンが無いジョブは failed になる", async () => {
    await seedUserOnly(db);
    const jobId = await seedJob(db);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["failed"]);
    expect(job.status).toBe("failed");
  });

  it("createRecord の 429 は待って再試行して done になる", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values({
      jobId,
      annictWorkId: ANNICT_WORK_ID,
      annictEpisodeId: 101,
      episodeNodeId: "Ep-101",
      status: "pending",
      updatedAt: now,
    });
    let recordAttempts = 0;
    const calls = installAnnictMock({
      createRecord: () => {
        recordAttempts += 1;
        if (recordAttempts === 1) {
          return jsonResponse({ errors: [{ message: "rate limited" }] }, 429);
        }
        return jsonResponse({
          data: {
            createRecord: {
              record: {
                id: "Rec-1",
                annictId: 9001,
                createdAt: "2026-01-01T00:00:00Z",
              },
            },
          },
        });
      },
    });

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items[0]!.status).toBe("done");
    expect(
      calls.filter((c) => c.query.includes("createRecord")).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
