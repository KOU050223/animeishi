import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { achievements } from "@/features/achievements";
import { users, annictWorks, watchHistory, episodeRecords } from "@/db/schema";
import { currentAnnictSeason } from "@/lib/annict/client";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testach01";
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
  app.route("/me/achievements", achievements);
  return app;
}

function gqlJson(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// バルク話数取得（WORKS_EPISODE_IDS_QUERY）だけをモックする。
// 実際のクエリは episodes(first: 100 なので、先にこれを見る。
function mockAnnictEpisodeIds(episodeIdsByWork: Record<number, number[]>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const query: string = body.query ?? "";
      if (query.includes("episodes(first: 100")) {
        const ids: number[] = body.variables?.annictIds ?? [];
        return gqlJson({
          searchWorks: {
            nodes: ids.map((id) => ({
              annictId: id,
              episodes: {
                pageInfo: { hasNextPage: false },
                nodes: (episodeIdsByWork[id] ?? []).map((e) => ({
                  annictId: e,
                })),
              },
            })),
          },
        });
      }
      return gqlJson({});
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// JST の週 w の月曜 12:00 相当の Date。
function weekDate(weekIndex: number): Date {
  return new Date(
    (weekIndex * 7 - 3) * DAY_MS - JST_OFFSET_MS + 12 * 3600 * 1000,
  );
}

function currentWeekIndex(now = new Date()): number {
  const dayIndex = Math.floor((now.getTime() + JST_OFFSET_MS) / DAY_MS);
  return Math.floor((dayIndex + 3) / 7);
}

let db: Awaited<ReturnType<typeof setupTestDb>>;

type AchievementBody = {
  id: string;
  kind: string;
  threshold: number | null;
  earned: boolean;
  available: boolean;
  progress: { current: number; target: number | null };
  work?: { annictWorkId: number; title: string };
};

async function getAchievements(headers: Record<string, string> = {}) {
  const app = buildApp();
  const res = await app.request(
    "/me/achievements",
    { method: "GET", headers },
    TEST_BINDINGS,
  );
  return res;
}

function byId(list: AchievementBody[]): Map<string, AchievementBody> {
  return new Map(list.map((a) => [a.id, a]));
}

async function seedWatchHistories(
  states: { annictWorkId: number; state: string }[],
) {
  const now = new Date();
  for (const s of states) {
    await db.insert(annictWorks).values({
      annictWorkId: s.annictWorkId,
      title: `作品${s.annictWorkId}`,
      updatedAt: now,
    });
    await db.insert(watchHistory).values({
      userId: USER_ID,
      annictWorkId: s.annictWorkId,
      state: s.state as "WATCHED",
      updatedAt: now,
    });
  }
}

async function seedEpisodeRecord(args: {
  annictWorkId: number;
  annictEpisodeId: number;
  annictRecordId: number;
  recordedAt: Date;
}) {
  await db.insert(episodeRecords).values({
    userId: USER_ID,
    annictWorkId: args.annictWorkId,
    annictEpisodeId: args.annictEpisodeId,
    annictRecordId: args.annictRecordId,
    source: "animeishi",
    recordedAt: args.recordedAt,
    createdAt: new Date(),
  });
}

describe("実績 API", () => {
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
  });

  it("未認証は 401", async () => {
    vi.mocked(getAuth).mockReturnValue(
      null as unknown as ReturnType<typeof getAuth>,
    );
    const res = await getAchievements();
    expect(res.status).toBe(401);
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("データが無くても全実績を返し、Annict 未連携時は今期完走のみ判定不可", async () => {
      const res = await getAchievements();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        achievements: AchievementBody[];
        season: string;
        stats: { watchedCount: number };
      };
      const m = byId(body.achievements);
      expect(body.season).toBe(currentAnnictSeason());
      // 視聴数・連続記録はデータ不足でも判定自体は可能（未獲得）
      expect(m.get("watch_count_10")?.available).toBe(true);
      expect(m.get("watch_count_10")?.earned).toBe(false);
      expect(m.get("record_streak_4")?.available).toBe(true);
      // Annict トークンが無いので今期完走だけ判定不可
      expect(m.get("season_completion")?.available).toBe(false);
      expect(m.get("season_completion")?.earned).toBe(false);
    });

    it("state=WATCHED の件数だけを視聴数バッジの判定に使う", async () => {
      const states = [
        ...Array.from({ length: 12 }, (_, i) => ({
          annictWorkId: 1000 + i,
          state: "WATCHED",
        })),
        { annictWorkId: 2000, state: "WATCHING" },
        { annictWorkId: 2001, state: "WANNA_WATCH" },
      ];
      await seedWatchHistories(states);

      const res = await getAchievements();
      const body = (await res.json()) as { achievements: AchievementBody[] };
      const m = byId(body.achievements);
      expect(m.get("watch_count_10")?.earned).toBe(true);
      expect(m.get("watch_count_50")?.earned).toBe(false);
      expect(m.get("watch_count_50")?.progress).toEqual({
        current: 12,
        target: 50,
      });
    });

    it("連続した週の記録で週単位ストリークを判定する", async () => {
      const now = new Date();
      await db.insert(annictWorks).values({
        annictWorkId: 3000,
        title: "連続記録の作品",
        updatedAt: now,
      });
      const w = currentWeekIndex();
      // 今週・先週・先々週に各 1 話（同じ週に 2 話あっても 1 週として数える）
      await seedEpisodeRecord({
        annictWorkId: 3000,
        annictEpisodeId: 1,
        annictRecordId: 5001,
        recordedAt: weekDate(w),
      });
      await seedEpisodeRecord({
        annictWorkId: 3000,
        annictEpisodeId: 2,
        annictRecordId: 5002,
        recordedAt: weekDate(w),
      });
      await seedEpisodeRecord({
        annictWorkId: 3000,
        annictEpisodeId: 3,
        annictRecordId: 5003,
        recordedAt: weekDate(w - 1),
      });
      await seedEpisodeRecord({
        annictWorkId: 3000,
        annictEpisodeId: 4,
        annictRecordId: 5004,
        recordedAt: weekDate(w - 2),
      });

      const res = await getAchievements();
      const body = (await res.json()) as {
        achievements: AchievementBody[];
        stats: { currentStreakWeeks: number; bestStreakWeeks: number };
      };
      const m = byId(body.achievements);
      expect(body.stats.bestStreakWeeks).toBe(3);
      expect(body.stats.currentStreakWeeks).toBe(3);
      expect(m.get("record_streak_4")?.earned).toBe(false);
      expect(m.get("record_streak_4")?.progress).toEqual({
        current: 3,
        target: 4,
      });
    });

    it("今期の作品を全話記録していれば今期完走を獲得する", async () => {
      const season = currentAnnictSeason();
      const now = new Date();
      await db.insert(annictWorks).values({
        annictWorkId: 4000,
        title: "今期の作品",
        seasonName: season,
        updatedAt: now,
      });
      // 別シーズンの作品は完走していても対象にならない
      await db.insert(annictWorks).values({
        annictWorkId: 4001,
        title: "前期の作品",
        seasonName: "2000-winter",
        updatedAt: now,
      });
      const w = currentWeekIndex();
      let recordId = 6000;
      for (const ep of [11, 12, 13]) {
        await seedEpisodeRecord({
          annictWorkId: 4000,
          annictEpisodeId: ep,
          annictRecordId: recordId++,
          recordedAt: weekDate(w),
        });
      }
      await seedEpisodeRecord({
        annictWorkId: 4001,
        annictEpisodeId: 21,
        annictRecordId: recordId++,
        recordedAt: weekDate(w),
      });
      mockAnnictEpisodeIds({
        4000: [11, 12, 13],
        4001: [21, 22],
      });

      const res = await getAchievements(ANNICT_HEADER);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { achievements: AchievementBody[] };
      const a = byId(body.achievements).get("season_completion");
      expect(a?.available).toBe(true);
      expect(a?.earned).toBe(true);
      expect(a?.work).toEqual({ annictWorkId: 4000, title: "今期の作品" });
      expect(a?.progress).toEqual({ current: 3, target: 3 });
    });

    it("今期の作品が未完なら、最も完走に近い作品の n/N を返す", async () => {
      const season = currentAnnictSeason();
      const now = new Date();
      await db.insert(annictWorks).values({
        annictWorkId: 5000,
        title: "未完の作品",
        seasonName: season,
        updatedAt: now,
      });
      const w = currentWeekIndex();
      let recordId = 7000;
      for (const ep of [31, 32]) {
        await seedEpisodeRecord({
          annictWorkId: 5000,
          annictEpisodeId: ep,
          annictRecordId: recordId++,
          recordedAt: weekDate(w),
        });
      }
      mockAnnictEpisodeIds({ 5000: [31, 32, 33, 34] });

      const res = await getAchievements(ANNICT_HEADER);
      const body = (await res.json()) as { achievements: AchievementBody[] };
      const a = byId(body.achievements).get("season_completion");
      expect(a?.earned).toBe(false);
      expect(a?.progress).toEqual({ current: 2, target: 4 });
      expect(a?.work?.title).toBe("未完の作品");
    });

    it("候補が 50 本を超えても全件を照合し、完走済みの短編を見落とさない", async () => {
      const season = currentAnnictSeason();
      const now = new Date();
      const w = currentWeekIndex();
      let recordId = 9000;
      const masters: Record<number, number[]> = {};
      // 未完の長編 50 本（各 10 話記録・全 12 話）。記録話数順では
      // 完走した短編より先に並び、1 チャンク目を占める。
      for (let i = 0; i < 50; i++) {
        const workId = 9000 + i;
        await db.insert(annictWorks).values({
          annictWorkId: workId,
          title: `未完${i}`,
          seasonName: season,
          updatedAt: now,
        });
        const recorded: number[] = [];
        for (let ep = 0; ep < 10; ep++) {
          const epId = i * 100 + ep;
          recorded.push(epId);
          await seedEpisodeRecord({
            annictWorkId: workId,
            annictEpisodeId: epId,
            annictRecordId: recordId++,
            recordedAt: weekDate(w),
          });
        }
        masters[workId] = [...recorded, i * 100 + 10, i * 100 + 11];
      }
      // 完走した 1 話完結の短編。記録話数が最少のため末尾のチャンクに回る。
      await db.insert(annictWorks).values({
        annictWorkId: 9060,
        title: "完走の短編",
        seasonName: season,
        updatedAt: now,
      });
      await seedEpisodeRecord({
        annictWorkId: 9060,
        annictEpisodeId: 999001,
        annictRecordId: recordId++,
        recordedAt: weekDate(w),
      });
      masters[9060] = [999001];

      const fetchSpy = mockAnnictEpisodeIds(masters);

      const res = await getAchievements(ANNICT_HEADER);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { achievements: AchievementBody[] };
      const a = byId(body.achievements).get("season_completion");
      expect(a?.earned).toBe(true);
      expect(a?.work?.annictWorkId).toBe(9060);
      // 50 件超の候補は上限 50 件ずつの 2 リクエストに分けて取得する。
      const bulkCalls = fetchSpy.mock.calls.filter((c) =>
        (JSON.parse((c[1]?.body as string) ?? "{}").query ?? "").includes(
          "episodes(first: 100",
        ),
      );
      expect(bulkCalls.length).toBe(2);
    });

    it("Annict 障害時は今期完走だけ判定不可に倒し、他の実績は返す", async () => {
      const fetchMock: Mock<typeof fetch> = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response("error", { status: 500 }));
      void fetchMock;
      const season = currentAnnictSeason();
      const now = new Date();
      await db.insert(annictWorks).values({
        annictWorkId: 6000,
        title: "判定対象の作品",
        seasonName: season,
        updatedAt: now,
      });
      await seedEpisodeRecord({
        annictWorkId: 6000,
        annictEpisodeId: 41,
        annictRecordId: 8001,
        recordedAt: weekDate(currentWeekIndex()),
      });

      const res = await getAchievements(ANNICT_HEADER);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { achievements: AchievementBody[] };
      const m = byId(body.achievements);
      expect(m.get("season_completion")?.available).toBe(false);
      expect(m.get("watch_count_10")?.available).toBe(true);
      expect(m.get("record_streak_4")?.available).toBe(true);
    });
  });
});
