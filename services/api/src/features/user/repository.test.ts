import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { findUserWatchSummary } from "./repository";
import { annictWorks, favorites, users, watchHistory } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";

async function insertWork(
  db: Awaited<ReturnType<typeof setupTestDb>>,
  annictWorkId: number,
  title: string,
) {
  await db.insert(annictWorks).values({
    annictWorkId,
    title,
    updatedAt: new Date(),
  });
}

describe("findUserWatchSummary", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_ID,
        username: "テストユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ANOTHER_USER_ID,
        username: "別のユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("キャッシュが無いユーザーは全て 0 件・syncedAt は null", async () => {
    const summary = await findUserWatchSummary(db, USER_ID);
    expect(summary).toEqual({
      watchedCount: 0,
      watchingCount: 0,
      wannaWatchCount: 0,
      favoriteCount: 0,
      favoriteTitles: [],
      syncedAt: null,
    });
  });

  it("状態別の件数を集計し、ON_HOLD / STOP_WATCHING は集計対象外", async () => {
    for (const id of [1001, 1002, 1003, 1004, 1005]) {
      await insertWork(db, id, `作品${id}`);
    }
    const now = new Date();
    await db.insert(watchHistory).values([
      { userId: USER_ID, annictWorkId: 1001, state: "WATCHED", updatedAt: now },
      { userId: USER_ID, annictWorkId: 1002, state: "WATCHED", updatedAt: now },
      {
        userId: USER_ID,
        annictWorkId: 1003,
        state: "WATCHING",
        updatedAt: now,
      },
      {
        userId: USER_ID,
        annictWorkId: 1004,
        state: "WANNA_WATCH",
        updatedAt: now,
      },
      { userId: USER_ID, annictWorkId: 1005, state: "ON_HOLD", updatedAt: now },
      // 他人のデータは混ざらない
      {
        userId: ANOTHER_USER_ID,
        annictWorkId: 1001,
        state: "WATCHED",
        updatedAt: now,
      },
    ]);

    const summary = await findUserWatchSummary(db, USER_ID);
    expect(summary.watchedCount).toBe(2);
    expect(summary.watchingCount).toBe(1);
    expect(summary.wannaWatchCount).toBe(1);
    // ON_HOLD など名刺に載せない状態はどの項目にも入らない
    expect(
      summary.watchedCount + summary.watchingCount + summary.wannaWatchCount,
    ).toBe(4);
  });

  it("favoriteTitles はお気に入り登録の新しい順・最大3件", async () => {
    for (const id of [1001, 1002, 1003, 1004]) {
      await insertWork(db, id, `作品${id}`);
    }
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    for (const [i, workId] of [1001, 1002, 1003, 1004].entries()) {
      await db.insert(favorites).values({
        userId: USER_ID,
        annictWorkId: workId,
        createdAt: new Date(base + i * 1000),
      });
    }

    const summary = await findUserWatchSummary(db, USER_ID);
    expect(summary.favoriteCount).toBe(4);
    expect(summary.favoriteTitles).toEqual([
      "作品1004",
      "作品1003",
      "作品1002",
    ]);
  });

  it("syncedAt は watch_history / favorites の最新時刻のうち新しい方", async () => {
    await insertWork(db, 1001, "作品1001");
    await db.insert(watchHistory).values({
      userId: USER_ID,
      annictWorkId: 1001,
      state: "WATCHED",
      updatedAt: new Date("2026-10-10T00:00:00Z"),
    });
    await db.insert(favorites).values({
      userId: USER_ID,
      annictWorkId: 1001,
      createdAt: new Date("2026-10-12T00:00:00Z"),
    });

    const summary = await findUserWatchSummary(db, USER_ID);
    expect(summary.syncedAt).toEqual(new Date("2026-10-12T00:00:00Z"));
  });
});
