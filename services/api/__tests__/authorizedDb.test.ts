import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "./helpers/setup-db";
import { authorizedDb } from "@/repository/authorizedDb";
import { annictWorks, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

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

    // テスト用 annict_works を作成
    await db.insert(annictWorks).values([
      {
        annictWorkId: WORK_ID_1,
        title: "進撃の巨人",
        seasonName: "2013-spring",
        seasonYear: 2013,
        updatedAt: now,
      },
      {
        annictWorkId: WORK_ID_2,
        title: "鬼滅の刃",
        seasonName: "2019-spring",
        seasonYear: 2019,
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
      await anotherAdb.upsertMyProfile({
        username: "ユーザー2",
        isPublic: true,
      });

      // 各 authorizedDb は自分のプロフィールのみ返す
      const profile1 = await adb.getMyProfile();
      const profile2 = await anotherAdb.getMyProfile();

      expect(profile1?.username).toBe("ユーザー1");
      expect(profile2?.username).toBe("ユーザー2");
    });
  });

  describe("annict_works 操作", () => {
    it("IDで作品を取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const work = await adb.getAnnictWorkById(WORK_ID_1);
      expect(work).toBeDefined();
      expect(work?.title).toBe("進撃の巨人");
    });

    it("存在しない作品IDは undefined", async () => {
      const adb = authorizedDb(db, USER_ID);
      const work = await adb.getAnnictWorkById(99999);
      expect(work).toBeUndefined();
    });

    it("作品を upsert できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      const now = new Date();
      await adb.upsertAnnictWork({
        annictWorkId: 9999,
        title: "新作アニメ",
        seasonName: "2026-spring",
        seasonYear: 2026,
        updatedAt: now,
      });
      const work = await adb.getAnnictWorkById(9999);
      expect(work?.title).toBe("新作アニメ");
    });
  });

  describe("視聴履歴操作", () => {
    it("視聴履歴を追加・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.annictWorkId).toBe(WORK_ID_1);
      expect(history[0]?.state).toBe("WATCHING");
    });

    it("視聴履歴を更新できる（upsert）", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHED" });

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(1); // 重複しない
      expect(history[0]?.state).toBe("WATCHED");
    });

    it("他ユーザーの視聴履歴は取得されない", async () => {
      const adb = authorizedDb(db, USER_ID);
      const anotherAdb = authorizedDb(db, ANOTHER_USER_ID);

      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await anotherAdb.upsertWatchHistory(WORK_ID_2, { state: "WATCHED" });

      const myHistory = await adb.getMyWatchHistory();
      expect(myHistory).toHaveLength(1);
      expect(myHistory[0]?.annictWorkId).toBe(WORK_ID_1);
    });

    it("視聴履歴を削除できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await adb.deleteWatchHistory(WORK_ID_1);

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(0);
    });

    it("視聴履歴を全置換できる（replaceMyWatchHistory）", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      await adb.replaceMyWatchHistory([
        { annictWorkId: WORK_ID_1, state: "WATCHED" },
        { annictWorkId: WORK_ID_2, state: "WANNA_WATCH" },
      ]);

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(2);
    });

    it("replaceMyWatchHistory: 空配列で全削除できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await adb.replaceMyWatchHistory([]);

      const history = await adb.getMyWatchHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe("お気に入り操作", () => {
    it("お気に入りを追加・取得できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(WORK_ID_1);

      const favs = await adb.getMyFavorites();
      expect(favs).toHaveLength(1);
      expect(favs[0]?.annictWorkId).toBe(WORK_ID_1);
    });

    it("同じ作品を重複追加しても1件のみ", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(WORK_ID_1);
      await adb.addFavorite(WORK_ID_1); // 2回目は onConflictDoNothing

      const favs = await adb.getMyFavorites();
      expect(favs).toHaveLength(1);
    });

    it("お気に入りを削除できる", async () => {
      const adb = authorizedDb(db, USER_ID);
      await adb.addFavorite(WORK_ID_1);
      await adb.removeFavorite(WORK_ID_1);

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
        "自分自身をフレンドに追加することはできません",
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
});
