import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { usersRepository, DeletedUserError } from "./repository";
import { annictWorks, deletedUsers, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

describe("usersRepository", () => {
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
      const repo = usersRepository(db, USER_ID);
      const profile = await repo.getMyProfile();
      expect(profile).toBeDefined();
      expect(profile?.username).toBe("テストユーザー");
    });

    it("プロフィールを更新できる", async () => {
      const repo = usersRepository(db, USER_ID);
      const updated = await repo.upsertMyProfile({
        username: "更新後ユーザー",
        bio: "自己紹介文",
        isPublic: false,
      });
      expect(updated.username).toBe("更新後ユーザー");
      expect(updated.bio).toBe("自己紹介文");
      expect(updated.isPublic).toBe(false);
    });

    it("raw SQL 経路でも createdAt/updatedAt が正しい単位（秒）で保存される", async () => {
      // mode: "timestamp" は秒保存。raw SQL でミリ秒を書く回帰
      // （読み取り時に1000倍されて壊れる）を検知する。
      const before = Date.now();
      const repo = usersRepository(db, USER_ID);
      const updated = await repo.upsertMyProfile({
        username: "時刻確認",
        isPublic: true,
      });
      const after = Date.now();
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(updated.updatedAt.getTime()).toBeLessThanOrEqual(after + 1000);
    });

    it("省略した項目は既存値を温存する（部分更新）", async () => {
      const repo = usersRepository(db, USER_ID);
      await repo.upsertMyProfile({
        username: "更新前",
        bio: "自己紹介",
        favoriteQuote: "名言",
        isPublic: false,
        profileImageUrl: "https://example.com/icon.webp",
      });

      // username のみ指定 → 他の項目は既存値のまま残ること
      const updated = await repo.upsertMyProfile({ username: "名前だけ更新" });
      expect(updated.username).toBe("名前だけ更新");
      expect(updated.bio).toBe("自己紹介");
      expect(updated.favoriteQuote).toBe("名言");
      expect(updated.isPublic).toBe(false);
      expect(updated.profileImageUrl).toBe("https://example.com/icon.webp");
    });

    it("currentUserId 以外のユーザーIDで更新できないことを確認（スコープ分離）", async () => {
      const repo = usersRepository(db, USER_ID);
      const anotherRepo = usersRepository(db, ANOTHER_USER_ID);

      await repo.upsertMyProfile({ username: "ユーザー1", isPublic: true });
      await anotherRepo.upsertMyProfile({
        username: "ユーザー2",
        isPublic: true,
      });

      // 各リポジトリは自分のプロフィールのみ返す
      const profile1 = await repo.getMyProfile();
      const profile2 = await anotherRepo.getMyProfile();

      expect(profile1?.username).toBe("ユーザー1");
      expect(profile2?.username).toBe("ユーザー2");
    });
  });

  describe("削除済みユーザーの tombstone（issue #144）", () => {
    const DELETED_ID = "user_deleted001";

    it("deleteMyAccount は users 行と一緒に tombstone を残す", async () => {
      const repo = usersRepository(db, USER_ID);
      await repo.deleteMyAccount();

      const tombstones = await db
        .select()
        .from(deletedUsers)
        .where(eq(deletedUsers.userId, USER_ID));
      expect(tombstones).toHaveLength(1);
      expect(
        await db.select().from(users).where(eq(users.id, USER_ID)),
      ).toHaveLength(0);
      // 他ユーザーには tombstone が付かない
      expect(
        await db
          .select()
          .from(deletedUsers)
          .where(eq(deletedUsers.userId, ANOTHER_USER_ID)),
      ).toHaveLength(0);
    });

    it("tombstone があるユーザーは upsertMyProfile で users 行が再作成されない", async () => {
      await db
        .insert(deletedUsers)
        .values({ userId: DELETED_ID, deletedAt: new Date() });

      const repo = usersRepository(db, DELETED_ID);
      // INSERT が抑止された場合は削除済みとして DeletedUserError が投げられる
      // （handleError で 401 に変換される）。
      await expect(
        repo.upsertMyProfile({ username: "復活しない", isPublic: true }),
      ).rejects.toThrow(DeletedUserError);
      expect(
        await db.select().from(users).where(eq(users.id, DELETED_ID)),
      ).toHaveLength(0);
    });

    it("tombstone があるユーザーは ensureUserExists で users 行が作られない", async () => {
      await db
        .insert(deletedUsers)
        .values({ userId: DELETED_ID, deletedAt: new Date() });

      const repo = usersRepository(db, DELETED_ID);
      await repo.ensureUserExists(async () => "表示名");
      expect(
        await db.select().from(users).where(eq(users.id, DELETED_ID)),
      ).toHaveLength(0);
    });

    it("clearMyDeletedAt で tombstone 解除後は通常どおりプロビジョニングできる", async () => {
      await db
        .insert(deletedUsers)
        .values({ userId: DELETED_ID, deletedAt: new Date() });

      const repo = usersRepository(db, DELETED_ID);
      expect(await repo.getMyDeletedAt()).toBeDefined();
      await repo.clearMyDeletedAt();
      expect(await repo.getMyDeletedAt()).toBeUndefined();

      await repo.ensureUserExists(async () => "復帰ユーザー");
      const recreated = await db
        .select()
        .from(users)
        .where(eq(users.id, DELETED_ID));
      expect(recreated).toHaveLength(1);
      expect(recreated[0]?.username).toBe("復帰ユーザー");
    });
  });

  describe("ジャンル操作", () => {
    it("ジャンルを設定・取得できる", async () => {
      const repo = usersRepository(db, USER_ID);
      await repo.setMyGenres(["アクション", "ファンタジー"]);

      const genres = await repo.getMyGenres();
      expect(genres).toHaveLength(2);
      expect(genres).toContain("アクション");
      expect(genres).toContain("ファンタジー");
    });

    it("ジャンルを上書き設定できる", async () => {
      const repo = usersRepository(db, USER_ID);
      await repo.setMyGenres(["アクション", "ファンタジー"]);
      await repo.setMyGenres(["SF"]);

      const genres = await repo.getMyGenres();
      expect(genres).toHaveLength(1);
      expect(genres[0]).toBe("SF");
    });
  });
});
