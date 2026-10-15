import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../../test-utils/setup-db";
import { watchHistoryRepository } from "./repository";
import { worksRepository } from "../works/repository";
import { annictWorks, users } from "@/db/schema";

const USER_ID = "user_testuser001";
const ANOTHER_USER_ID = "user_testuser002";
const WORK_ID_1 = 1001;
const WORK_ID_2 = 1002;

describe("watchHistoryRepository", () => {
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

  describe("視聴履歴操作", () => {
    it("視聴履歴を追加・取得できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.annictWorkId).toBe(WORK_ID_1);
      expect(history[0]?.state).toBe("WATCHING");
      // annict_works と JOIN して作品タイトルを返す
      expect(history[0]?.title).toBe("進撃の巨人");
    });

    it("視聴履歴を更新できる（upsert）", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHED" });

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(1); // 重複しない
      expect(history[0]?.state).toBe("WATCHED");
    });

    it("他ユーザーの視聴履歴は取得されない", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const anotherRepo = watchHistoryRepository(db, ANOTHER_USER_ID);

      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await anotherRepo.upsertWatchHistory(WORK_ID_2, { state: "WATCHED" });

      const myHistory = await repo.getMyWatchHistory();
      expect(myHistory).toHaveLength(1);
      expect(myHistory[0]?.annictWorkId).toBe(WORK_ID_1);
    });

    it("視聴履歴を削除できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await repo.deleteWatchHistory(WORK_ID_1);

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(0);
    });

    it("視聴履歴を全置換できる（replaceMyWatchHistory）", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      await repo.replaceMyWatchHistory([
        { annictWorkId: WORK_ID_1, state: "WATCHED" },
        { annictWorkId: WORK_ID_2, state: "WANNA_WATCH" },
      ]);

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(2);
      const work1 = history.find((h) => h.annictWorkId === WORK_ID_1);
      const work2 = history.find((h) => h.annictWorkId === WORK_ID_2);
      expect(work1?.state).toBe("WATCHED"); // WATCHING → WATCHED に置換されていること
      expect(work2?.state).toBe("WANNA_WATCH");
    });

    it("replaceMyWatchHistory: 空配列で全削除できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });
      await repo.replaceMyWatchHistory([]);

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(0);
    });

    it("syncMyLibraryFromAnnict: 未登録作品を annict_works に upsert しつつ全置換できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      const now = new Date();
      const NEW_WORK_ID = 2001; // annict_works に未登録の新規作品

      // Annict 側に存在しない既存履歴。全置換契約なら同期後に消えているはず。
      const STALE_WORK_ID = 2999;
      await worksRepo.upsertAnnictWork({
        annictWorkId: STALE_WORK_ID,
        title: "削除される作品",
        updatedAt: now,
      });
      await repo.upsertWatchHistory(STALE_WORK_ID, { state: "WATCHING" });

      const result = await repo.syncMyLibraryFromAnnict(
        [
          {
            annictWorkId: WORK_ID_1,
            title: "進撃の巨人",
            seasonName: "2013-spring",
            seasonYear: 2013,
            updatedAt: now,
          },
          {
            annictWorkId: NEW_WORK_ID,
            title: "新規作品",
            seasonName: "2026-spring",
            seasonYear: 2026,
            updatedAt: now,
          },
        ],
        [
          { annictWorkId: WORK_ID_1, state: "WATCHED" },
          { annictWorkId: NEW_WORK_ID, state: "WANNA_WATCH" },
        ],
      );

      // 返り値が置換後の履歴になっている
      expect(result).toHaveLength(2);

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(2);
      expect(history.find((h) => h.annictWorkId === WORK_ID_1)?.state).toBe(
        "WATCHED",
      );
      expect(history.find((h) => h.annictWorkId === NEW_WORK_ID)?.state).toBe(
        "WANNA_WATCH",
      );
      // Annict 側に存在しない既存履歴は全置換で削除されている
      expect(
        history.find((h) => h.annictWorkId === STALE_WORK_ID),
      ).toBeUndefined();

      // 新規作品が annict_works キャッシュに入っている
      const cached = await worksRepo.getAnnictWorkById(NEW_WORK_ID);
      expect(cached?.title).toBe("新規作品");
    });

    it("syncMyLibraryFromAnnict: works のみ・履歴 0 件でも作品キャッシュは更新される", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      await repo.upsertWatchHistory(WORK_ID_1, { state: "WATCHING" });

      const now = new Date();
      const NEW_WORK_ID = 2002;
      const result = await repo.syncMyLibraryFromAnnict(
        [
          {
            annictWorkId: NEW_WORK_ID,
            title: "状態なし作品",
            updatedAt: now,
          },
        ],
        [], // NO_STATE 等で保存対象の履歴が無いケース
      );

      // 履歴は全削除される
      expect(result).toHaveLength(0);
      expect(await repo.getMyWatchHistory()).toHaveLength(0);
      // 作品キャッシュは残る
      expect((await worksRepo.getAnnictWorkById(NEW_WORK_ID))?.title).toBe(
        "状態なし作品",
      );
    });

    it("syncMyLibraryFromAnnict: チャンク境界を跨ぐ大量データを全件同期できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      const now = new Date();

      // WORK_CHUNK(100) / WATCH_CHUNK(200) の両方を跨ぐ件数で検証する。
      const COUNT = 250;
      const works = Array.from({ length: COUNT }, (_, i) => ({
        annictWorkId: 5000 + i,
        title: `作品${i}`,
        updatedAt: now,
      }));
      const entries = works.map((w, i) => ({
        annictWorkId: w.annictWorkId,
        state: (i % 2 === 0 ? "WATCHING" : "WATCHED") as "WATCHING" | "WATCHED",
      }));

      const result = await repo.syncMyLibraryFromAnnict(works, entries);

      // 全件が漏れなく入る（チャンク分割で欠落しない）
      expect(result).toHaveLength(COUNT);
      expect(await repo.getMyWatchHistory()).toHaveLength(COUNT);
      // 末尾チャンクの作品もキャッシュされている
      expect((await worksRepo.getAnnictWorkById(5000 + COUNT - 1))?.title).toBe(
        `作品${COUNT - 1}`,
      );
    });
  });
});
