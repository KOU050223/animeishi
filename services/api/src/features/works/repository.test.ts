import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { worksRepository } from "./repository";
import { annictWorks, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

describe("worksRepository", () => {
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

  describe("annict_works 操作", () => {
    it("IDで作品を取得できる", async () => {
      const repo = worksRepository(db);
      const work = await repo.getAnnictWorkById(WORK_ID_1);
      expect(work).toBeDefined();
      expect(work?.title).toBe("進撃の巨人");
    });

    it("存在しない作品IDは undefined", async () => {
      const repo = worksRepository(db);
      const work = await repo.getAnnictWorkById(99999);
      expect(work).toBeUndefined();
    });

    it("作品を upsert できる", async () => {
      const repo = worksRepository(db);
      const now = new Date();
      await repo.upsertAnnictWork({
        annictWorkId: 9999,
        title: "新作アニメ",
        seasonName: "2026-spring",
        seasonYear: 2026,
        updatedAt: now,
      });
      const work = await repo.getAnnictWorkById(9999);
      expect(work?.title).toBe("新作アニメ");
    });

    it("作品を upsert で更新できる（同じ ID で上書き）", async () => {
      const repo = worksRepository(db);
      const now = new Date();
      await repo.upsertAnnictWork({
        annictWorkId: WORK_ID_1,
        title: "進撃の巨人 Final Season",
        seasonName: "2022-winter",
        seasonYear: 2022,
        updatedAt: now,
      });
      const work = await repo.getAnnictWorkById(WORK_ID_1);
      expect(work?.title).toBe("進撃の巨人 Final Season");
      expect(work?.seasonYear).toBe(2022);
    });
  });

  describe("削除依頼で画像を消した作品（image_source='blocked'。issue #241）", () => {
    async function block(annictWorkId: number, malAnimeId: number) {
      await db
        .update(annictWorks)
        .set({ malAnimeId, imageSource: "blocked", resolvedImageUrl: null })
        .where(eq(annictWorks.annictWorkId, annictWorkId));
    }

    it("MAL ID が変わる upsert でも 'blocked' を外さない", async () => {
      await block(WORK_ID_1, 21);
      const repo = worksRepository(db);
      await repo.upsertAnnictWork({
        annictWorkId: WORK_ID_1,
        malAnimeId: 22,
        title: "進撃の巨人",
        updatedAt: new Date(),
      });
      const work = await repo.getAnnictWorkById(WORK_ID_1);
      expect(work?.malAnimeId).toBe(22);
      expect(work?.imageSource).toBe("blocked");
    });

    it("補完結果の書き込みで 'blocked' の行を書き換えない", async () => {
      await block(WORK_ID_1, 21);
      const repo = worksRepository(db);
      const update = {
        resolvedImageUrl: "https://cdn.myanimelist.net/images/anime/21l.jpg",
        imageSource: "mal",
        resolvedAt: new Date(),
      };
      await repo.updateResolvedImage(WORK_ID_1, update);
      await repo.updateResolvedImages([
        { annictWorkId: WORK_ID_1, ...update },
        { annictWorkId: WORK_ID_2, ...update },
      ]);
      const blocked = await repo.getAnnictWorkById(WORK_ID_1);
      expect(blocked?.imageSource).toBe("blocked");
      expect(blocked?.resolvedImageUrl).toBeNull();
      // 'blocked' でない行は従来どおり書き込まれる。
      expect((await repo.getAnnictWorkById(WORK_ID_2))?.imageSource).toBe(
        "mal",
      );
    });
  });
});
