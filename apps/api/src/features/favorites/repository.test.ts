import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { favoritesRepository } from "./repository";
import { annictWorks, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

describe("favoritesRepository", () => {
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

  describe("お気に入り操作", () => {
    it("お気に入りを追加・取得できる", async () => {
      const repo = favoritesRepository(db, USER_ID);
      await repo.addFavorite(WORK_ID_1);

      const favs = await repo.getMyFavorites();
      expect(favs).toHaveLength(1);
      expect(favs[0]?.annictWorkId).toBe(WORK_ID_1);
      // annict_works と JOIN して作品タイトルを返す
      expect(favs[0]?.title).toBe("進撃の巨人");
    });

    it("同じ作品を重複追加しても1件のみ", async () => {
      const repo = favoritesRepository(db, USER_ID);
      await repo.addFavorite(WORK_ID_1);
      await repo.addFavorite(WORK_ID_1); // 2回目は onConflictDoNothing

      const favs = await repo.getMyFavorites();
      expect(favs).toHaveLength(1);
    });

    it("お気に入りを削除できる", async () => {
      const repo = favoritesRepository(db, USER_ID);
      await repo.addFavorite(WORK_ID_1);
      await repo.removeFavorite(WORK_ID_1);

      const favs = await repo.getMyFavorites();
      expect(favs).toHaveLength(0);
    });
  });
});
