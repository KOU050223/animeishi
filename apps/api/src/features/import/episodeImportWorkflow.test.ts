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
import { eq, DrizzleQueryError } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import {
  annictTokens,
  annictWorks,
  danimeEpisodeImportItems,
  danimeEpisodeImportJobs,
  danimeEpisodeImportWorks,
  episodeRecords,
  users,
} from "#src/db/schema";
import { encryptToken } from "#src/lib/annict/crypto";
import type { DanimeEpisodeJobStatus } from "#src/db/schema";
import { isSubrequestLimitError } from "./episodeImportWorkflow";

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

type AnnictMockCall = {
  query: string;
  episodeId: string | undefined;
  after: string | null | undefined;
};

// Annict GraphQL の POST ボディを種類別に振り分けるモック。
// query のオペレーション名で判別する（WorksEpisodes=一括取得、
// WorkEpisodes=1 作品のページング取得）。
function installAnnictMock(opts?: {
  createRecord?: (call: AnnictMockCall, index: number) => Response;
  // 複数作品の話一覧一括取得（WORKS_EPISODES_QUERY）の応答差し替え。
  batchEpisodes?: (call: AnnictMockCall) => Response;
  // 1 作品の話一覧ページング取得（WORK_EPISODES_QUERY）の応答差し替え。
  workEpisodes?: (call: AnnictMockCall) => Response;
  // Annict 側で記録済みにする annictEpisodeId（既定は 102）。
  trackedEpisodes?: number[];
}) {
  const tracked = new Set(opts?.trackedEpisodes ?? [102]);
  const defaultEpisodes = () =>
    jsonResponse({
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
                    viewerDidTrack: tracked.has(101),
                    viewerRecordsCount: tracked.has(101) ? 1 : 0,
                  },
                  {
                    id: "Ep-102",
                    annictId: 102,
                    number: 2,
                    numberText: "第2話",
                    sortNumber: 2,
                    title: "サブタイトル2",
                    // Annict 記録済み。書き込み対象から外れるべき話。
                    viewerDidTrack: tracked.has(102),
                    viewerRecordsCount: tracked.has(102) ? 1 : 0,
                  },
                ],
              },
            },
          ],
        },
      },
    });
  const calls: AnnictMockCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as {
            query?: string;
            variables?: { episodeId?: string; after?: string | null };
          })
        : {};
    const q = body.query ?? "";
    const call = {
      query: q,
      episodeId: body.variables?.episodeId,
      after: body.variables?.after,
    };
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
    if (q.includes("query WorksEpisodes")) {
      return opts?.batchEpisodes?.(call) ?? defaultEpisodes();
    }
    if (q.includes("query WorkEpisodes")) {
      return opts?.workEpisodes?.(call) ?? defaultEpisodes();
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
    // サブリクエスト予算の既定（テストごとに小さくして上限を再現する）。
    env.DANIME_SUBREQUEST_BUDGET = "40";
    env.DANIME_D1_SUBREQUEST_BUDGET = "500";
    // 引き継ぎ回数上限の既定（上限検証テストだけ小さくする）。
    env.DANIME_MAX_HANDOFFS = "100";
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
    const calls = installAnnictMock({ trackedEpisodes: [] });

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");

    // 対応付けフェーズは走らない。episodes 問い合わせは書き込み直前の
    // 記録状況の再確認（pending アイテムの作品分）1 件だけ。
    expect(calls.filter((c) => c.query.includes("episodes"))).toHaveLength(1);
    const recordCalls = calls.filter((c) => c.query.includes("createRecord"));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]!.episodeId).toBe("Ep-102");
  });

  it("書き込み直前の再確認で記録済みが見つかった話は送らずスキップする", async () => {
    // createRecord 成功後に D1 確定前で落ちたケースの再現。pending の
    // アイテムが Annict 上では記録済み → 再送せず skipped にする。
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values([
      {
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId: 102,
        episodeNodeId: "Ep-102",
        status: "pending",
        updatedAt: now,
      },
    ]);
    // モックは Ep-102 を記録済みとして返す（既定値）
    const calls = installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");

    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      0,
    );
    const item = await db.query.danimeEpisodeImportItems.findFirst();
    expect(item?.status).toBe("skipped");
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

  it("サブリクエスト予算を使い切った話は failed にせず pending のまま残し、後続インスタンスが書き込む", async () => {
    // issue #695: Workers のサブリクエスト上限はインスタンス累計のため、
    // 自前の予算を使い切ったら新しいインスタンスに引き継ぐ。
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values(
      [101, 102, 103, 104, 105].map((annictEpisodeId) => ({
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId,
        episodeNodeId: `Ep-${annictEpisodeId}`,
        status: "pending" as const,
        updatedAt: now,
      })),
    );
    // 再確認 1 + createRecord 3 で枯渇する予算。残り 2 話は引き継ぎ先へ。
    env.DANIME_SUBREQUEST_BUDGET = "4";
    const calls = installAnnictMock({ trackedEpisodes: [] });

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    // 中断した話は failed にならず、引き継ぎ先で全件 done になる。
    // （failed に倒すと pending 一覧に載らず永久に書かれないため、
    // 全件 done = 引き継ぎが機能した証拠）
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items.map((i) => i.status).toSorted()).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    // 中断した話に createRecord が二度飛ばない（再送しない）。
    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      5,
    );
  });

  it("Workers のサブリクエスト上限で fetch が例外になった話も pending のまま後続インスタンスで書き込まれる", async () => {
    // issue #695: 予算を超えてプラットフォーム上限（"Too many
    // subrequests." の status 0 例外）に当たった場合の安全網。
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values([
      {
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId: 101,
        episodeNodeId: "Ep-101",
        status: "pending",
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
    // Ep-102 の最初の createRecord だけ、上限到達相当の例外を投げる
    // （後続インスタンスでは成功する＝新しい実行では回復する）。
    let ep102Attempts = 0;
    const calls = installAnnictMock({
      trackedEpisodes: [],
      createRecord: (call) => {
        if (call.episodeId === "Ep-102" && ep102Attempts++ === 0) {
          throw new Error("Too many subrequests.");
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
    expect(items.map((i) => i.status).toSorted()).toEqual(["done", "done"]);
    // 上限で投げられた 1 回と、引き継ぎ先での再送 1 回。
    const ep102Calls = calls.filter((c) => c.episodeId === "Ep-102");
    expect(ep102Calls).toHaveLength(2);
  });

  it("対応付けの途中で予算を使い切ったジョブは、中断した作品から引き継いで完了する", async () => {
    await seedUserAndToken(db);
    const jobId = await seedJob(db);
    // バッチに話一覧が載らない作品 2 件（各フォールバック取得が 2 往復）。
    // 予算 3 ではバッチ取得 + 1 作品分で尽き、2 作品目は引き継ぎになる。
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    env.DANIME_SUBREQUEST_BUDGET = "3";
    const pagedEpisodes = (call: AnnictMockCall) =>
      jsonResponse({
        data: {
          searchWorks: {
            nodes: [
              {
                annictId: ANNICT_WORK_ID,
                episodes: {
                  pageInfo:
                    call.after == null
                      ? { hasNextPage: true, endCursor: "page-2" }
                      : { hasNextPage: false, endCursor: null },
                  nodes:
                    call.after == null
                      ? [
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
                        ]
                      : [
                          {
                            id: "Ep-102",
                            annictId: 102,
                            number: 2,
                            numberText: "第2話",
                            sortNumber: 2,
                            title: "サブタイトル2",
                            viewerDidTrack: false,
                            viewerRecordsCount: 0,
                          },
                        ],
                },
              },
            ],
          },
        },
      });
    const calls = installAnnictMock({
      trackedEpisodes: [],
      batchEpisodes: () =>
        jsonResponse({
          data: {
            searchWorks: {
              nodes: [
                {
                  annictId: ANNICT_WORK_ID,
                  episodes: {
                    // 50 話超で打ち切られた扱い → matchWork は個別
                    // ページングにフォールバックする。
                    pageInfo: { hasNextPage: true, endCursor: null },
                    nodes: [],
                  },
                },
              ],
            },
          },
        }),
      workEpisodes: pagedEpisodes,
    });

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    // 引き継ぎ先で対応付けが再開され、確定した話が書き込まれる。
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    // 2 作品とも同じ Annict 話（101/102）に確定するが、ジョブ内の
    // 重複排除でアイテムは 2 件だけ。
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === "done")).toBe(true);
    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      2,
    );
  });

  it("前のジョブで failed になった話は、新しいジョブで再び書き込み対象になる", async () => {
    // issue #695: 記録済みの話は対応付け時に skipped になるため、
    // ジョブを作り直せば failed の話だけが再送される（二重にならない）。
    await seedUserAndToken(db);
    const oldJobId = await seedJob(db, { status: "completed" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values({
      jobId: oldJobId,
      annictWorkId: ANNICT_WORK_ID,
      annictEpisodeId: 101,
      episodeNodeId: "Ep-101",
      status: "failed",
      error: "Annict GraphQL request failed",
      updatedAt: now,
    });

    const jobId = await seedJob(db);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    const calls = installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    // 前ジョブで failed だった 101 が新ジョブで書き込まれる
    // （102 は Annict 記録済みとして skipped）。
    const recordCalls = calls.filter((c) => c.query.includes("createRecord"));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]!.episodeId).toBe("Ep-101");
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items.find((i) => i.annictEpisodeId === 101)?.status).toBe("done");
  });

  it("予算が 1 話ぶん未満でも 1 話ずつ進み、無限引き継ぎにならず完了する", async () => {
    // Devin Review #699: 小さい予算で fetch を途中拒否すると、引き継ぎ先が
    // 同じ話を最初からやり直して永久に進まない。ユニット境界でだけ
    // 予算を見るため、各インスタンスが最低 1 話ずつ進んで収束する。
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values(
      [101, 102, 103].map((annictEpisodeId) => ({
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId,
        episodeNodeId: `Ep-${annictEpisodeId}`,
        status: "pending" as const,
        updatedAt: now,
      })),
    );
    // 再確認 1 + createRecord 1 で 1 話ぶんの最小コストより小さい予算。
    env.DANIME_SUBREQUEST_BUDGET = "1";
    const calls = installAnnictMock({ trackedEpisodes: [] });

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
    expect(items.every((i) => i.status === "done")).toBe(true);
    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      3,
    );
  });

  it("予算が話一覧 1 作品ぶん未満でも、ページング途中で中断せず作品ごとに進んで完了する", async () => {
    // Devin Review #699 の再現: 予算 2 で 2 ページの話一覧を持つ作品を
    // 処理すると、ページング途中で中断すると毎回同じ作品を取り直して
    // 無限引き継ぎになる。ページングは中断しないので収束する。
    await seedUserAndToken(db);
    const jobId = await seedJob(db);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    await seedWork(db, jobId, WORK_EPISODES_JSON);
    // バッチ取得 1 + ページング 2 で 1 作品ぶんを下回る予算。
    env.DANIME_SUBREQUEST_BUDGET = "2";
    const pagedEpisodes = (call: AnnictMockCall) =>
      jsonResponse({
        data: {
          searchWorks: {
            nodes: [
              {
                annictId: ANNICT_WORK_ID,
                episodes: {
                  pageInfo:
                    call.after == null
                      ? { hasNextPage: true, endCursor: "page-2" }
                      : { hasNextPage: false, endCursor: null },
                  nodes:
                    call.after == null
                      ? [
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
                        ]
                      : [
                          {
                            id: "Ep-102",
                            annictId: 102,
                            number: 2,
                            numberText: "第2話",
                            sortNumber: 2,
                            title: "サブタイトル2",
                            viewerDidTrack: false,
                            viewerRecordsCount: 0,
                          },
                        ],
                },
              },
            ],
          },
        },
      });
    const calls = installAnnictMock({
      trackedEpisodes: [],
      batchEpisodes: () =>
        jsonResponse({
          data: {
            searchWorks: {
              nodes: [
                {
                  annictId: ANNICT_WORK_ID,
                  episodes: {
                    pageInfo: { hasNextPage: true, endCursor: null },
                    nodes: [],
                  },
                },
              ],
            },
          },
        }),
      workEpisodes: pagedEpisodes,
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
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === "done")).toBe(true);
    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      2,
    );
  });

  it("D1 呼び出しが多いジョブは D1 予算の上限前に引き継ぎ、記録インスタンスが引き継ぎ先になる", async () => {
    // issue #701: D1 への問い合わせもインスタンス単位のサブリクエスト
    // （内部サービス向け 1,000）として数えられる。fetch だけを数える
    // 予算では上限に達して Errored になったため、D1 も予算化して
    // 手前で次インスタンスへ引き継ぐ。
    await seedUserAndToken(db);
    const jobId = await seedJob(db);
    for (let i = 0; i < 6; i++) {
      await seedWork(db, jobId, WORK_EPISODES_JSON);
    }
    // fetch・ステップ数ではなく D1 呼び出し数だけが律速になる設定
    // （作品あたり 2〜3 クエリなので、予算 12 では数作品ごとに引き継ぐ）。
    env.DANIME_WORKFLOW_STEP_BUDGET = "100";
    env.DANIME_D1_SUBREQUEST_BUDGET = "12";
    const calls = installAnnictMock();

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["completed", "failed"]);
    expect(job.status).toBe("completed");
    // D1 予算で引き継いだため、記録されるインスタンスは引き継ぎ先の
    // `${jobId}-hN`（進捗参照・新規作成時の調停はこの ID を見る）。
    expect(job.workflowInstanceId).toMatch(new RegExp(`^${jobId}-h\\d+$`));
    // 引き継ぎを挟んでも対応付け〜書き込みは最後まで走る。
    // 全作品が同じ Annict 話に確定するため、重複排除でアイテムは 2 件。
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.annictEpisodeId === 101)?.status).toBe("done");
    expect(items.find((i) => i.annictEpisodeId === 102)?.status).toBe(
      "skipped",
    );
    expect(calls.filter((c) => c.query.includes("createRecord"))).toHaveLength(
      1,
    );
  });

  it("引き継ぎ回数の上限を超えたジョブは failed になる", async () => {
    // Devin Review #699: ユニット単位で必ず進む設計のため上限到達は
    // 異常系だが、収束しない場合にインスタンスを無限に作らせない
    // 保証として引き継ぎ回数の上限で failed に倒す。
    await seedUserAndToken(db);
    const jobId = await seedJob(db, { status: "writing" });
    const now = new Date();
    await db.insert(danimeEpisodeImportItems).values(
      [101, 102, 103].map((annictEpisodeId) => ({
        jobId,
        annictWorkId: ANNICT_WORK_ID,
        annictEpisodeId,
        episodeNodeId: `Ep-${annictEpisodeId}`,
        status: "pending" as const,
        updatedAt: now,
      })),
    );
    // 1 話ごとに引き継ぐ予算 + 引き継ぎ 1 回までの上限。
    env.DANIME_SUBREQUEST_BUDGET = "1";
    env.DANIME_MAX_HANDOFFS = "1";
    installAnnictMock({ trackedEpisodes: [] });

    await env.DANIME_EPISODE_IMPORT.create({
      id: jobId,
      params: { jobId, userId: USER_ID },
    });

    const job = await waitForJob(db, jobId, ["failed"]);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("handoff limit");
    // 上限までに進んだ分は残る（2 話 done、残り 1 話は pending のまま）。
    const items = await db
      .select()
      .from(danimeEpisodeImportItems)
      .where(eq(danimeEpisodeImportItems.jobId, jobId));
    expect(items.filter((i) => i.status === "done")).toHaveLength(2);
    expect(items.filter((i) => i.status === "pending")).toHaveLength(1);
  });

  it("D1 の上限エラーが DrizzleQueryError に包まれていても cause を見て上限到達と判定する", () => {
    // CodeRabbit #702: drizzle-orm はクエリ失敗を DrizzleQueryError に
    // 包み、元の "Too many subrequests." は cause に入る。message だけを
    // 見ると通常の失敗経路へ進んで引き継ぎ対象にならない。
    const wrapped = new DrizzleQueryError(
      "SELECT 1",
      [],
      new Error("Too many subrequests."),
    );
    expect(isSubrequestLimitError(wrapped)).toBe(true);
    // 上限と無関係なクエリ失敗は従来どおりのエラー扱い
    const other = new DrizzleQueryError(
      "SELECT 1",
      [],
      new Error("no such table: foo"),
    );
    expect(isSubrequestLimitError(other)).toBe(false);
    expect(isSubrequestLimitError(new Error("some other failure"))).toBe(false);
  });
});
