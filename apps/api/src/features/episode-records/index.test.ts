import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { episodeRecords, workEpisodes } from "@/features/episode-records";
import {
  users,
  annictWorks,
  episodeRecords as episodeRecordsTable,
} from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testep001";
const ANNICT_WORK_ID = 12345;
const ANNICT_EPISODE_ID = 501;

const ANNICT_HEADER = { "X-Annict-Token": "tok_test" };

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/episode-records", episodeRecords);
  app.route("/works", workEpisodes);
  return app;
}

// --- Annict GraphQL モック ---
// query 文字列の内容で呼び先を振り分ける（クライアント実装のクエリ名に依存）。
type EpisodeFixture = {
  annictId: number;
  number?: number | null;
  numberText?: string | null;
  sortNumber?: number;
  title?: string | null;
  viewerDidTrack?: boolean;
  viewerRecordsCount?: number;
};

function episodeNode(e: EpisodeFixture) {
  return {
    id: `Episode-${e.annictId}`,
    annictId: e.annictId,
    number: e.number ?? e.annictId,
    numberText: e.numberText ?? `第${e.number ?? e.annictId}話`,
    sortNumber: e.sortNumber ?? e.annictId,
    title: e.title ?? null,
    viewerDidTrack: e.viewerDidTrack ?? false,
    viewerRecordsCount: e.viewerRecordsCount ?? 0,
  };
}

type RecordFixture = {
  annictRecordId: number;
  annictEpisodeId: number;
  annictWorkId?: number;
  createdAt?: string;
};

function recordNode(r: RecordFixture) {
  return {
    id: `Record-${r.annictRecordId}`,
    annictId: r.annictRecordId,
    createdAt: r.createdAt ?? "2026-10-01T10:00:00Z",
    episode: { annictId: r.annictEpisodeId },
    work: { annictId: r.annictWorkId ?? ANNICT_WORK_ID },
  };
}

function gqlJson(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

type AnnictMockOptions = {
  // work.episodes ページ（nodes + 継続カーソル）。既定は 1 ページで終わる。
  episodePages?: {
    episodes: EpisodeFixture[];
    endCursor: string | null;
  }[];
  // viewer.records をページごとに返す。ページ数超過は最後の応答を繰り返す。
  recordPages?: {
    records: RecordFixture[];
    hasNextPage: boolean;
    endCursor: string | null;
  }[];
  // searchEpisodes（話の解決）で返す話。省略時は episodes の annictId から拾う。
  episodeLookup?: (EpisodeFixture & { annictWorkId?: number })[];
  // searchWorks（作品メタ解決 / GET /works での話数取得）で作品を返すか。
  workMissing?: boolean;
  // createRecord の結果 record。既定は annictRecordId=900。
  createdRecordId?: number;
  // createRecord / deleteRecord を失敗させる HTTP ステータス。
  createRecordStatus?: number;
  deleteRecordStatus?: number;
  // 全 GraphQL 呼び出しを同じ HTTP ステータスで失敗させる。
  httpStatus?: number;
};

function mockAnnict(opts: AnnictMockOptions = {}): Mock<typeof fetch> {
  let recordPageIndex = 0;
  let episodePageIndex = 0;
  let createdRecordId = opts.createdRecordId ?? 900;

  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      if (opts.httpStatus) {
        return new Response("error", { status: opts.httpStatus });
      }
      const body = JSON.parse((init?.body as string) ?? "{}");
      const query: string = body.query ?? "";

      if (query.includes("createRecord")) {
        if (opts.createRecordStatus) {
          return new Response("error", { status: opts.createRecordStatus });
        }
        const id = createdRecordId++;
        return gqlJson({
          createRecord: {
            record: {
              id: `Record-${id}`,
              annictId: id,
              createdAt: "2026-11-05T12:00:00Z",
            },
          },
        });
      }

      if (query.includes("deleteRecord")) {
        if (opts.deleteRecordStatus) {
          return new Response("error", { status: opts.deleteRecordStatus });
        }
        return gqlJson({ deleteRecord: { clientMutationId: null } });
      }

      // viewer.records（create/delete の前に判定しないと mutation を拾うので
      // "records(first" の形だけを見る）。
      if (query.includes("records(first")) {
        const pages = opts.recordPages ?? [
          { records: [], hasNextPage: false, endCursor: null },
        ];
        const page = pages[Math.min(recordPageIndex++, pages.length - 1)]!;
        return gqlJson({
          viewer: {
            records: {
              pageInfo: {
                hasNextPage: page.hasNextPage,
                endCursor: page.endCursor,
              },
              nodes: page.records.map(recordNode),
            },
          },
        });
      }

      if (query.includes("searchEpisodes")) {
        const annictId: number = body.variables?.annictIds?.[0];
        const found = (opts.episodeLookup ?? []).find(
          (e) => e.annictId === annictId,
        );
        return gqlJson({
          searchEpisodes: {
            nodes: found
              ? [
                  {
                    ...episodeNode(found),
                    work: { annictId: found.annictWorkId ?? ANNICT_WORK_ID },
                  },
                ]
              : [],
          },
        });
      }

      // work.episodes（話数一覧）。searchWorks の中に episodes(first が入る。
      if (query.includes("episodes(first")) {
        const pages = opts.episodePages ?? [{ episodes: [], endCursor: null }];
        const page = pages[Math.min(episodePageIndex++, pages.length - 1)]!;
        const annictWorkId: number = body.variables?.annictIds?.[0];
        return gqlJson({
          searchWorks: {
            nodes: opts.workMissing
              ? []
              : [
                  {
                    annictId: annictWorkId,
                    episodes: {
                      pageInfo: {
                        hasNextPage: page.endCursor != null,
                        endCursor: page.endCursor,
                      },
                      nodes: page.episodes.map(episodeNode),
                    },
                  },
                ],
          },
        });
      }

      // 作品メタ解決（SearchWorkNodeId）
      if (query.includes("searchWorks")) {
        const annictId: number = body.variables?.annictIds?.[0];
        return gqlJson({
          searchWorks: {
            nodes: opts.workMissing
              ? []
              : [
                  {
                    id: `Work-${annictId}`,
                    annictId,
                    malAnimeId: null,
                    title: `作品${annictId}`,
                    titleKana: null,
                    titleEn: null,
                    seasonName: null,
                    seasonYear: null,
                    media: "TV",
                    watchersCount: null,
                    image: { recommendedImageUrl: null },
                  },
                ],
          },
        });
      }

      return gqlJson({});
    });
}

async function listEpisodeRecords() {
  return db.query.episodeRecords.findMany({
    where: (t, { eq }) => eq(t.userId, USER_ID),
    orderBy: (t, { asc }) => [asc(t.annictEpisodeId)],
  });
}

let db: Awaited<ReturnType<typeof setupTestDb>>;

describe("話数記録 API", () => {
  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.restoreAllMocks();

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(annictWorks).values({
      annictWorkId: ANNICT_WORK_ID,
      nodeId: `Work-${ANNICT_WORK_ID}`,
      title: "テストアニメ",
      updatedAt: now,
    });
  });

  describe("認証なし", () => {
    it("GET /works/:id/episodes: 401", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const app = buildApp();
      const res = await app.request(
        `/works/${ANNICT_WORK_ID}/episodes`,
        { method: "GET", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("PUT /me/episode-records/:id: 401", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );
      const app = buildApp();
      const res = await app.request(
        `/me/episode-records/${ANNICT_EPISODE_ID}`,
        { method: "PUT", headers: ANNICT_HEADER },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    describe("GET /works/:annictWorkId/episodes", () => {
      it("X-Annict-Token が無ければ 401", async () => {
        const app = buildApp();
        const res = await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("annict_token_required");
      });

      it("Annict の話数一覧を視聴状況付きで返す", async () => {
        mockAnnict({
          episodePages: [
            {
              episodes: [
                {
                  annictId: 501,
                  number: 1,
                  viewerDidTrack: true,
                  viewerRecordsCount: 1,
                },
                { annictId: 502, number: 2 },
                { annictId: 503, number: 3 },
              ],
              endCursor: null,
            },
          ],
          recordPages: [
            {
              records: [{ annictRecordId: 10, annictEpisodeId: 501 }],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        const res = await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          episodes: {
            annictEpisodeId: number;
            numberText: string | null;
            watched: boolean;
            recordsCount: number;
            lastRecordedAt: string | null;
          }[];
        };
        expect(body.episodes.map((e) => e.annictEpisodeId)).toEqual([
          501, 502, 503,
        ]);
        expect(body.episodes[0]?.watched).toBe(true);
        expect(body.episodes[0]?.recordsCount).toBe(1);
        expect(body.episodes[1]?.watched).toBe(false);
        // Annict record の createdAt が lastRecordedAt に載る。
        expect(body.episodes[0]?.lastRecordedAt).toBe(
          new Date("2026-10-01T10:00:00Z").toISOString(),
        );
        expect(body.episodes[1]?.lastRecordedAt).toBeNull();
      });

      it("Annict の既存記録を source=annict で D1 ログに取り込む", async () => {
        mockAnnict({
          episodePages: [
            {
              episodes: [
                {
                  annictId: 501,
                  viewerDidTrack: true,
                  viewerRecordsCount: 1,
                },
                { annictId: 502 },
              ],
              endCursor: null,
            },
          ],
          recordPages: [
            {
              records: [
                {
                  annictRecordId: 10,
                  annictEpisodeId: 501,
                  createdAt: "2026-10-01T10:00:00Z",
                },
              ],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        const rows = await listEpisodeRecords();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: 501,
          annictRecordId: 10,
          recordNodeId: "Record-10",
          episodeNodeId: "Episode-501",
          source: "annict",
        });
        // 記録日時は D1 への取り込み時刻ではなく Annict record の createdAt。
        expect(rows[0]?.recordedAt).toEqual(new Date("2026-10-01T10:00:00Z"));
      });

      it("2 回目の取得で D1 ログが重複しない（annict_record_id で dedup）", async () => {
        const pages = [
          {
            episodes: [
              {
                annictId: 501,
                viewerDidTrack: true,
                viewerRecordsCount: 1,
              },
            ],
            endCursor: null,
          },
        ];
        mockAnnict({
          episodePages: pages,
          recordPages: [
            {
              records: [{ annictRecordId: 10, annictEpisodeId: 501 }],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        for (let i = 0; i < 2; i++) {
          await app.request(
            `/works/${ANNICT_WORK_ID}/episodes`,
            { method: "GET", headers: ANNICT_HEADER },
            TEST_BINDINGS,
          );
        }

        const rows = await listEpisodeRecords();
        expect(rows).toHaveLength(1);
      });

      it("Annict 側で消えた記録は D1 ログからも消す（reconcile）", async () => {
        // 事前に D1 に古い記録を入れておく（Annict 側はもう無い）。
        const now = new Date();
        await db.insert(episodeRecordsTable).values({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: 501,
          annictRecordId: 999,
          recordNodeId: "Record-999",
          source: "annict",
          recordedAt: new Date("2026-09-01T00:00:00Z"),
          createdAt: now,
        });

        mockAnnict({
          episodePages: [
            {
              episodes: [
                {
                  annictId: 501,
                  viewerDidTrack: true,
                  viewerRecordsCount: 1,
                },
              ],
              endCursor: null,
            },
          ],
          // Annict 側の現行記録は recordId=10 だけ（999 は削除済み）。
          recordPages: [
            {
              records: [{ annictRecordId: 10, annictEpisodeId: 501 }],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        const rows = await listEpisodeRecords();
        expect(rows.map((r) => r.annictRecordId)).toEqual([10]);
      });

      it("viewer.records が読めなくても話数一覧自体は返す", async () => {
        // records クエリだけ 500 にするモックを個別構成する。
        vi.spyOn(globalThis, "fetch").mockImplementation(async (_i, init) => {
          const body = JSON.parse((init?.body as string) ?? "{}");
          const query: string = body.query ?? "";
          if (query.includes("records(first")) {
            return new Response("error", { status: 500 });
          }
          if (query.includes("episodes(first")) {
            const annictWorkId: number = body.variables?.annictIds?.[0];
            return gqlJson({
              searchWorks: {
                nodes: [
                  {
                    annictId: annictWorkId,
                    episodes: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        episodeNode({ annictId: 501, viewerDidTrack: true }),
                      ],
                    },
                  },
                ],
              },
            });
          }
          return gqlJson({});
        });

        const app = buildApp();
        const res = await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        // D1 同期は best-effort（次回取得で収束する）。話数一覧の表示を
        // 壊さないよう 200 を返す。
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          episodes: { watched: boolean }[];
        };
        expect(body.episodes[0]?.watched).toBe(true);
      });

      it("作品が見つからなければ 404", async () => {
        mockAnnict({ workMissing: true });
        const app = buildApp();
        const res = await app.request(
          `/works/99999/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(404);
      });

      it("Annict が 401 なら annict_token_invalid で 401", async () => {
        mockAnnict({ httpStatus: 401 });
        const app = buildApp();
        const res = await app.request(
          `/works/${ANNICT_WORK_ID}/episodes`,
          { method: "GET", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("annict_token_invalid");
      });
    });

    describe("PUT /me/episode-records/:annictEpisodeId", () => {
      it("X-Annict-Token が無ければ 401", async () => {
        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "PUT" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("annict_token_required");
      });

      it("Annict createRecord で記録し、source=animeishi の D1 ログを残す", async () => {
        const fetchMock = mockAnnict({
          episodeLookup: [{ annictId: ANNICT_EPISODE_ID }],
          createdRecordId: 900,
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "PUT", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          recorded: boolean;
          annictRecordId: number;
        };
        expect(body.recorded).toBe(true);
        expect(body.annictRecordId).toBe(900);

        // createRecord に Episode の Node ID が渡る。
        const createCall = fetchMock.mock.calls.find((call) =>
          (
            JSON.parse((call[1] as RequestInit).body as string).query ?? ""
          ).includes("createRecord"),
        );
        const vars = JSON.parse(
          (createCall![1] as RequestInit).body as string,
        ).variables;
        expect(vars.episodeId).toBe(`Episode-${ANNICT_EPISODE_ID}`);

        const rows = await listEpisodeRecords();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: ANNICT_EPISODE_ID,
          episodeNodeId: `Episode-${ANNICT_EPISODE_ID}`,
          annictRecordId: 900,
          recordNodeId: "Record-900",
          source: "animeishi",
        });
        expect(rows[0]?.recordedAt).toEqual(new Date("2026-11-05T12:00:00Z"));
      });

      it("既に記録済み（viewerDidTrack）の話は二重に record を作らない", async () => {
        const fetchMock = mockAnnict({
          episodeLookup: [
            {
              annictId: ANNICT_EPISODE_ID,
              viewerDidTrack: true,
              viewerRecordsCount: 1,
            },
          ],
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "PUT", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { recorded: boolean };
        expect(body.recorded).toBe(false);
        expect(
          fetchMock.mock.calls.some((call) =>
            (
              JSON.parse((call[1] as RequestInit).body as string).query ?? ""
            ).includes("createRecord"),
          ),
        ).toBe(false);
      });

      it("annict_works に無い作品の話でも、作品メタをキャッシュしてから記録する", async () => {
        const OTHER_WORK = 777;
        mockAnnict({
          episodeLookup: [
            { annictId: ANNICT_EPISODE_ID, annictWorkId: OTHER_WORK },
          ],
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "PUT", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);

        const work = await db.query.annictWorks.findFirst({
          where: (t, { eq }) => eq(t.annictWorkId, OTHER_WORK),
        });
        expect(work).toBeDefined();
        const rows = await listEpisodeRecords();
        expect(rows[0]?.annictWorkId).toBe(OTHER_WORK);
      });

      it("話が見つからなければ 404（createRecord しない）", async () => {
        const fetchMock = mockAnnict({ episodeLookup: [] });
        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/999999`,
          { method: "PUT", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(404);
        expect(
          fetchMock.mock.calls.some((call) =>
            (
              JSON.parse((call[1] as RequestInit).body as string).query ?? ""
            ).includes("createRecord"),
          ),
        ).toBe(false);
      });

      it("createRecord が失敗したら D1 ログを残さない", async () => {
        mockAnnict({
          episodeLookup: [{ annictId: ANNICT_EPISODE_ID }],
          createRecordStatus: 500,
        });
        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "PUT", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(502);
        expect(await listEpisodeRecords()).toHaveLength(0);
      });
    });

    describe("DELETE /me/episode-records/:annictEpisodeId", () => {
      it("X-Annict-Token が無ければ 401", async () => {
        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "DELETE" },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(401);
      });

      it("Annict の record と D1 ログの両方を消す", async () => {
        // D1 に animeishi 由来の記録がある状態からのチェック解除。
        const now = new Date();
        await db.insert(episodeRecordsTable).values({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: ANNICT_EPISODE_ID,
          episodeNodeId: `Episode-${ANNICT_EPISODE_ID}`,
          annictRecordId: 10,
          recordNodeId: "Record-10",
          source: "animeishi",
          recordedAt: now,
          createdAt: now,
        });

        const fetchMock = mockAnnict({
          episodeLookup: [
            {
              annictId: ANNICT_EPISODE_ID,
              viewerDidTrack: true,
              viewerRecordsCount: 1,
            },
          ],
          recordPages: [
            {
              records: [
                { annictRecordId: 10, annictEpisodeId: ANNICT_EPISODE_ID },
              ],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "DELETE", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);

        // deleteRecord に Record Node ID が渡る。
        const deleteCalls = fetchMock.mock.calls.filter((call) =>
          (
            JSON.parse((call[1] as RequestInit).body as string).query ?? ""
          ).includes("deleteRecord"),
        );
        expect(deleteCalls).toHaveLength(1);
        const vars = JSON.parse(
          (deleteCalls[0]![1] as RequestInit).body as string,
        ).variables;
        expect(vars.recordId).toBe("Record-10");

        expect(await listEpisodeRecords()).toHaveLength(0);
      });

      it("D1 に無い Annict 側の記録も viewer.records から拾って消す", async () => {
        // Annict アプリ側で記録 → Animeishi でチェック解除する流れ。
        // D1 には行が無いが viewer.records から recordNodeId を解決する。
        const fetchMock = mockAnnict({
          episodeLookup: [
            {
              annictId: ANNICT_EPISODE_ID,
              viewerDidTrack: true,
              viewerRecordsCount: 2,
            },
          ],
          recordPages: [
            {
              records: [
                { annictRecordId: 30, annictEpisodeId: ANNICT_EPISODE_ID },
                { annictRecordId: 31, annictEpisodeId: ANNICT_EPISODE_ID },
              ],
              hasNextPage: false,
              endCursor: null,
            },
          ],
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "DELETE", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);

        const deleteCalls = fetchMock.mock.calls.filter((call) =>
          (
            JSON.parse((call[1] as RequestInit).body as string).query ?? ""
          ).includes("deleteRecord"),
        );
        // 同一話に 2 件の record があれば両方消す（未視聴状態に戻す）。
        expect(deleteCalls).toHaveLength(2);
      });

      it("Annict 側に記録が無い（viewerDidTrack=false）なら D1 だけ消して成功", async () => {
        const now = new Date();
        await db.insert(episodeRecordsTable).values({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: ANNICT_EPISODE_ID,
          source: "annict",
          recordedAt: now,
          createdAt: now,
        });
        const fetchMock = mockAnnict({
          episodeLookup: [{ annictId: ANNICT_EPISODE_ID }],
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "DELETE", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(200);
        expect(await listEpisodeRecords()).toHaveLength(0);
        expect(
          fetchMock.mock.calls.some((call) =>
            (
              JSON.parse((call[1] as RequestInit).body as string).query ?? ""
            ).includes("deleteRecord"),
          ),
        ).toBe(false);
      });

      it("話が見つからなければ 404", async () => {
        mockAnnict({ episodeLookup: [] });
        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/999999`,
          { method: "DELETE", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(404);
      });

      it("deleteRecord が失敗したら D1 ログを残す", async () => {
        const now = new Date();
        await db.insert(episodeRecordsTable).values({
          userId: USER_ID,
          annictWorkId: ANNICT_WORK_ID,
          annictEpisodeId: ANNICT_EPISODE_ID,
          annictRecordId: 10,
          recordNodeId: "Record-10",
          source: "animeishi",
          recordedAt: now,
          createdAt: now,
        });
        mockAnnict({
          episodeLookup: [
            {
              annictId: ANNICT_EPISODE_ID,
              viewerDidTrack: true,
              viewerRecordsCount: 1,
            },
          ],
          recordPages: [
            {
              records: [
                { annictRecordId: 10, annictEpisodeId: ANNICT_EPISODE_ID },
              ],
              hasNextPage: false,
              endCursor: null,
            },
          ],
          deleteRecordStatus: 500,
        });

        const app = buildApp();
        const res = await app.request(
          `/me/episode-records/${ANNICT_EPISODE_ID}`,
          { method: "DELETE", headers: ANNICT_HEADER },
          TEST_BINDINGS,
        );
        expect(res.status).toBe(502);
        // Annict 削除が失敗したのに D1 だけ消すと次回 reconcile で
        // 復活するずれが起きるため、ログは残す。
        expect(await listEpisodeRecords()).toHaveLength(1);
      });
    });
  });
});
