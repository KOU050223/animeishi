import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../test-utils/setup-db";
import { watchHistoryRepository } from "./repository";
import { worksRepository } from "../works/repository";
import {
  annictWorks,
  users,
  watchHistory as watchHistoryTable,
} from "@/db/schema";

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

    it("syncMyLibraryFromAnnict: 変化が無い同期では watch_history / annict_works を書き直さない", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      const past = new Date("2024-01-01T00:00:00Z");

      // beforeEach で入れた行の updated_at を過去に戻し、書き込みの有無を
      // updated_at の変化で検知できるようにする。
      await db
        .update(annictWorks)
        .set({ updatedAt: past })
        .where(eq(annictWorks.annictWorkId, WORK_ID_1));
      await db.insert(watchHistoryTable).values({
        userId: USER_ID,
        annictWorkId: WORK_ID_1,
        state: "WATCHING",
        updatedAt: past,
      });

      const result = await repo.syncMyLibraryFromAnnict(
        [
          {
            annictWorkId: WORK_ID_1,
            nodeId: null,
            malAnimeId: null,
            title: "進撃の巨人",
            titleKana: null,
            titleEn: null,
            seasonName: "2013-spring",
            seasonYear: 2013,
            imageUrl: null,
            updatedAt: new Date(),
          },
        ],
        [{ annictWorkId: WORK_ID_1, state: "WATCHING" }],
      );

      // 結果は同じ履歴を返すが、内容が変わらない行は書き直されていない
      // （updated_at が past のまま）。
      expect(result).toHaveLength(1);
      expect(result[0]?.updatedAt).toEqual(past);
      expect((await worksRepo.getAnnictWorkById(WORK_ID_1))?.updatedAt).toEqual(
        past,
      );
    });

    it("syncMyLibraryFromAnnict: 差分（追加・state 変更・削除）だけが書き込まれる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      const past = new Date("2024-01-01T00:00:00Z");
      const STALE_WORK_ID = 2999;
      const NEW_WORK_ID = 2001;

      await db.update(annictWorks).set({ updatedAt: past });
      await worksRepo.upsertAnnictWork({
        annictWorkId: STALE_WORK_ID,
        title: "削除される作品",
        updatedAt: past,
      });
      // WORK_ID_1: state が変わる / WORK_ID_2: 変わらない /
      // STALE: Annict 側から消える / NEW: 新規追加
      await db.insert(watchHistoryTable).values([
        {
          userId: USER_ID,
          annictWorkId: WORK_ID_1,
          state: "WATCHING",
          updatedAt: past,
        },
        {
          userId: USER_ID,
          annictWorkId: WORK_ID_2,
          state: "WATCHED",
          updatedAt: past,
        },
        {
          userId: USER_ID,
          annictWorkId: STALE_WORK_ID,
          state: "WATCHING",
          updatedAt: past,
        },
      ]);

      const workMeta = (annictWorkId: number, title: string) => ({
        annictWorkId,
        nodeId: null,
        malAnimeId: null,
        title,
        titleKana: null,
        titleEn: null,
        seasonName: null,
        seasonYear: null,
        imageUrl: null,
        updatedAt: new Date(),
      });
      await repo.syncMyLibraryFromAnnict(
        [
          {
            ...workMeta(WORK_ID_1, "進撃の巨人"),
            seasonName: "2013-spring",
            seasonYear: 2013,
          },
          {
            ...workMeta(WORK_ID_2, "鬼滅の刃"),
            seasonName: "2019-spring",
            seasonYear: 2019,
          },
          workMeta(NEW_WORK_ID, "新規作品"),
        ],
        [
          { annictWorkId: WORK_ID_1, state: "WATCHED" },
          { annictWorkId: WORK_ID_2, state: "WATCHED" },
          { annictWorkId: NEW_WORK_ID, state: "WANNA_WATCH" },
        ],
      );

      const history = await repo.getMyWatchHistory();
      const w1 = history.find((h) => h.annictWorkId === WORK_ID_1);
      const w2 = history.find((h) => h.annictWorkId === WORK_ID_2);
      const stale = history.find((h) => h.annictWorkId === STALE_WORK_ID);
      const added = history.find((h) => h.annictWorkId === NEW_WORK_ID);

      // state が変わった行だけ update される（updated_at が進む）。
      expect(w1?.state).toBe("WATCHED");
      expect(w1?.updatedAt.getTime()).toBeGreaterThan(past.getTime());
      // 変わらない行は書き込まれない（updated_at が past のまま）。
      expect(w2?.state).toBe("WATCHED");
      expect(w2?.updatedAt).toEqual(past);
      // Annict 側から消えた行だけ delete される。
      expect(stale).toBeUndefined();
      // 新しく現れた行だけ insert される。
      expect(added?.state).toBe("WANNA_WATCH");
    });

    it("syncMyLibraryFromAnnict: 作品メタが変わった作品だけ annict_works を書き直す", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      const past = new Date("2024-01-01T00:00:00Z");

      await db.update(annictWorks).set({ updatedAt: past });

      await repo.syncMyLibraryFromAnnict(
        [
          {
            annictWorkId: WORK_ID_1,
            nodeId: null,
            malAnimeId: null,
            title: "進撃の巨人 改題", // タイトルが変わった → 書き直し対象
            titleKana: null,
            titleEn: null,
            seasonName: "2013-spring",
            seasonYear: 2013,
            imageUrl: null,
            updatedAt: new Date(),
          },
          {
            annictWorkId: WORK_ID_2,
            nodeId: null,
            malAnimeId: null,
            title: "鬼滅の刃", // 変わらない → 書き直さない
            titleKana: null,
            titleEn: null,
            seasonName: "2019-spring",
            seasonYear: 2019,
            imageUrl: null,
            updatedAt: new Date(),
          },
        ],
        [],
      );

      const w1 = await worksRepo.getAnnictWorkById(WORK_ID_1);
      const w2 = await worksRepo.getAnnictWorkById(WORK_ID_2);
      expect(w1?.title).toBe("進撃の巨人 改題");
      expect(w1?.updatedAt.getTime()).toBeGreaterThan(past.getTime());
      expect(w2?.updatedAt).toEqual(past);
    });

    it("replaceMyWatchHistory: 変化が無ければ行を書き直さない", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const past = new Date("2024-01-01T00:00:00Z");

      await db.insert(watchHistoryTable).values({
        userId: USER_ID,
        annictWorkId: WORK_ID_1,
        state: "WATCHING",
        updatedAt: past,
      });

      await repo.replaceMyWatchHistory([
        { annictWorkId: WORK_ID_1, state: "WATCHING" },
      ]);

      const history = await repo.getMyWatchHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.updatedAt).toEqual(past);
    });

    it("syncMyLibraryFromAnnict: チャンク境界を跨ぐ大量データを全件同期できる", async () => {
      const repo = watchHistoryRepository(db, USER_ID);
      const worksRepo = worksRepository(db);
      const now = new Date();

      // ID_CHUNK(90) / WATCH_INSERT_CHUNK(20) / WRITE_BATCH(50) を跨ぐ件数で検証する。
      const COUNT = 250;
      const works = Array.from({ length: COUNT }, (_, i) => ({
        annictWorkId: 5000 + i,
        title: `作品${i}`,
        updatedAt: now,
      }));
      const entries = works.map((w, i) => ({
        annictWorkId: w.annictWorkId,
        state: i % 2 === 0 ? "WATCHING" : "WATCHED",
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
