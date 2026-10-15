import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { friendsRepository } from "./repository";
import { annictWorks, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

describe("friendsRepository", () => {
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

  describe("フレンド操作", () => {
    it("フレンドを追加・取得できる", async () => {
      const repo = friendsRepository(db, USER_ID);
      await repo.addFriend(ANOTHER_USER_ID);

      const friendList = await repo.getMyFriends();
      expect(friendList).toHaveLength(1);
      expect(friendList[0]?.friendId).toBe(ANOTHER_USER_ID);
    });

    it("自分自身をフレンドに追加しようとするとエラー", async () => {
      const repo = friendsRepository(db, USER_ID);
      await expect(repo.addFriend(USER_ID)).rejects.toThrow(
        "自分自身をフレンドに追加することはできません",
      );
    });
  });
});
