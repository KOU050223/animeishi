import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "./helpers/setup-db";
import { authorizedDb } from "../src/repository/authorizedDb";
import { animeTitles, users } from "../src/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";

describe("authorizedDb", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);

    // テストユーザーを作成
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

    // テスト用アニメを作成
    await db.insert(animeTitles).values([
      {
        title: "進撃の巨人",
        year: 2013,
        season: "spring",
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "鬼滅の刃",
        year: 2019,
        season: "spring",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  describe("プロフィール操作", () => {
    it("自分のプロフィールを取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const profile = await adb.getMyProfile();
      expect(profile).toBeDefined();
      expect(profile?.username).toBe("テストユーザー");
    });

    it("プロフィールを更新できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const updated = await adb.upsertMyProfile({
        username: "更新後ユーザー",
        bio: "自己紹介文",
        isPublic: false,
      });
      expect(updated.username).toBe("更新後ユーザー");
      expect(updated.bio).toBe("自己紹介文");
      expect(updated.isPublic).toBe(false);
    });

    it("currentUserId 以外のユーザーIDで更新できないことを確認（スコープ分離）", async () => {
      const adb = authorizedDb(db, USER_ID);
      const anotherAdb = authorizedDb(db, ANOTHER_USER_ID);

      await adb.upsertMyProfile({ username: "ユーザー1", isPublic: true });
      await anotherAdb.upsertMyProfile({ username: "ユーザー2", isPublic: true });

      // 各 authorizedDb は自分のプロフィールのみ返す
      const profile1 = await adb.getMyProfile();
      const profile2 = await anotherAdb.getMyProfile();

      expect(profile1?.username).toBe("ユーザー1");
      expect(profile2?.username).toBe("ユーザー2");
    });
  });

  describe("視聴履歴操作", () => {
    it("視聴履歴を追加・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(1, {
        status: "watching",
        score: null,
        comment: null,
        watchedAt: null,
      });

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.animeId).toBe(1);
      expect(history[0]?.status).toBe("watching");
    });

    it("視聴履歴を更新できる（upsert）", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(1, {
        status: "watching",
        score: null,
        comment: null,
        watchedAt: null,
      });
      await adb.upsertWatchHistory(1, {
        status: "completed",
        score: 9,
        comment: "最高だった",
        watchedAt: new Date(),
      });

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(1); // 重複しない
      expect(history[0]?.status).toBe("completed");
      expect(history[0]?.score).toBe(9);
    });

    it("他ユーザーの視聴履歴は取得されない", async () => {
      const adb = authorizedDb(db, USER_ID);
      const anotherAdb = authorizedDb(db, ANOTHER_USER_ID);

      await adb.upsertWatchHistory(1, { status: "watching", score: null, comment: null, watchedAt: null });
      await anotherAdb.upsertWatchHistory(2, { status: "completed", score: 10, comment: null, watchedAt: null });

      const myHistory = await adb.getMyWatchHistory();
      expect(myHistory).toHaveLength(1);
      expect(myHistory[0]?.animeId).toBe(1);
    });

    it("視聴履歴を削除できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(1, { status: "watching", score: null, comment: null, watchedAt: null });
      await adb.deleteWatchHistory(1);

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe("お気に入り操作", () => {
    it("お気に入りを追加・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(1);

      const favs = await adb.getMyFavorites();
      expect(favs).toHaveLength(1);
      expect(favs[0]?.animeId).toBe(1);
    });

    it("同じアニメを重複追加しても1件のみ", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(1);
      await adb.addFavorite(1); // 2回目は onConflictDoNothing

      const favs = await adb.getMyFavorites();
      expect(favs).toHaveLength(1);
    });

    it("お気に入りを削除できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(1);
      await adb.removeFavorite(1);

      const favs = await adb.getMyFavorites();
      expect(favs).toHaveLength(0);
    });
  });

  describe("フレンド操作", () => {
    it("フレンドを追加・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFriend(ANOTHER_USER_ID);

      const friendList = await adb.getMyFriends();
      expect(friendList).toHaveLength(1);
      expect(friendList[0]?.friendId).toBe(ANOTHER_USER_ID);
    });

    it("自分自身をフレンドに追加しようとするとエラー", async () => {
      const adb = authorizedDb(db, USER_ID);
      await expect(adb.addFriend(USER_ID)).rejects.toThrow(
        "自分自身をフレンドに追加することはできません"
      );
    });
  });

  describe("ジャンル操作", () => {
    it("ジャンルを設定・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.setMyGenres(["アクション", "ファンタジー"]);

      const genres = await adb.getMyGenres();
      expect(genres).toHaveLength(2);
      expect(genres).toContain("アクション");
      expect(genres).toContain("ファンタジー");
    });

    it("ジャンルを上書き設定できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.setMyGenres(["アクション", "ファンタジー"]);
      await adb.setMyGenres(["SF"]);

      const genres = await adb.getMyGenres();
      expect(genres).toHaveLength(1);
      expect(genres[0]).toBe("SF");
    });
  });

  describe("アニメタイトル取得", () => {
    it("全アニメタイトルを取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const titles = await adb.getAnimeTitles();
      expect(titles.length).toBeGreaterThanOrEqual(2);
    });

    it("IDでアニメを取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const title = await adb.getAnimeTitleById(1);
      expect(title).toBeDefined();
      expect(title?.title).toBe("進撃の巨人");
    });
  });
});
