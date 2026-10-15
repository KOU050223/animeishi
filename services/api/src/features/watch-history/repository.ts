import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { watchHistory, annictWorks } from "@/db/schema";
import type { WatchHistory, NewWatchHistory, NewAnnictWork } from "@/db/schema";
import type { AnnictWorkMeta } from "../works/repository";
import { worksRepository } from "../works/repository";

/** 視聴履歴の 1 件（作品メタを含む）。 */
export type WatchHistoryWithWork = WatchHistory & AnnictWorkMeta;

/**
 * watchHistoryRepository: 認証済みユーザーIDを束縛した watch_history
 * ドメインのリポジトリ層（旧 repository/authorizedDb.ts の
 * Watch History セクション）。作品カタログ（annict_works）への書き込みは
 * worksRepository に委譲する。
 */
export function watchHistoryRepository(db: DrizzleDb, currentUserId: string) {
  return {
    async getMyWatchHistory(): Promise<WatchHistoryWithWork[]> {
      return db
        .select({
          id: watchHistory.id,
          userId: watchHistory.userId,
          annictWorkId: watchHistory.annictWorkId,
          state: watchHistory.state,
          updatedAt: watchHistory.updatedAt,
          title: annictWorks.title,
          titleKana: annictWorks.titleKana,
          titleEn: annictWorks.titleEn,
          seasonName: annictWorks.seasonName,
          seasonYear: annictWorks.seasonYear,
          imageUrl: annictWorks.imageUrl,
          resolvedImageUrl: annictWorks.resolvedImageUrl,
          imageSource: annictWorks.imageSource,
          imageR2Key: annictWorks.imageR2Key,
        })
        .from(watchHistory)
        .innerJoin(
          annictWorks,
          eq(watchHistory.annictWorkId, annictWorks.annictWorkId),
        )
        .where(eq(watchHistory.userId, currentUserId))
        .orderBy(desc(watchHistory.updatedAt));
    },

    async upsertWatchHistory(
      annictWorkId: number,
      data: Pick<NewWatchHistory, "state">,
    ): Promise<WatchHistory> {
      const now = new Date();
      await db
        .insert(watchHistory)
        .values({
          userId: currentUserId,
          annictWorkId,
          ...data,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [watchHistory.userId, watchHistory.annictWorkId],
          set: { ...data, updatedAt: now },
        });
      const updated = await db.query.watchHistory.findFirst({
        where: (t, { and, eq: eq_ }) =>
          and(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
      if (!updated) throw new Error("視聴履歴の更新に失敗しました");
      return updated;
    },

    /**
     * 本人の視聴履歴を Annict libraryEntries で全置換する。
     * D1 の db.batch() でアトミックに delete → insert を実行する。
     */
    async replaceMyWatchHistory(
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<void> {
      const now = new Date();
      const deleteQuery = db
        .delete(watchHistory)
        .where(eq(watchHistory.userId, currentUserId));

      if (entries.length === 0) {
        await deleteQuery;
        return;
      }

      const insertQuery = db.insert(watchHistory).values(
        entries.map((e) => ({
          userId: currentUserId,
          annictWorkId: e.annictWorkId,
          state: e.state,
          updatedAt: now,
        })),
      );

      await db.batch([deleteQuery, insertQuery]);
    },

    /**
     * Annict libraryEntries の取得結果で本人のライブラリを read-through 同期する。
     *
     * watch_history.annictWorkId は annict_works への FK 制約があるため、
     * 「作品メタ upsert → watch_history 全置換」の順で実行する（作品が存在しない
     * 状態で履歴を insert すると FK 違反になる）。
     *
     * ヘビーユーザー（数百〜数千作品）でも 1 statement に過大なバインド変数を
     * 載せないよう、bulk insert を行ベースでチャンク分割する。D1 は 1 クエリ
     * あたりのバインド変数を 100 に制限している（SQLite 既定の 999 より厳しい）ため、
     * 行数 × カラム数 が 100 を超えないチャンクサイズにする。
     * works は冪等（upsert）なので先に全チャンクを流し、その後 watch_history を
     * 「delete を最初の insert チャンクと同 batch」にして全置換する。
     *
     * @param works 触れた作品のメタ（annict_works へ upsert するキャッシュ）
     * @param entries 全置換する本人の視聴履歴（works に含まれる作品のみ）
     * @returns 置換後の本人の視聴履歴（updatedAt 降順）
     */
    async syncMyLibraryFromAnnict(
      works: NewAnnictWork[],
      entries: Pick<NewWatchHistory, "annictWorkId" | "state">[],
    ): Promise<WatchHistoryWithWork[]> {
      const now = new Date();

      // 1 行あたりのバインド変数 = カラム数。D1 上限 100 を下回るよう余裕を持たせる。
      // watch_history は 4 カラム。
      const WATCH_CHUNK = 20; // 20 * 4 = 80 変数 < 100

      // db.batch は「最低 1 要素の非空タプル」を要求するためのヘルパ。
      const runBatch = (queries: BatchItem<"sqlite">[]) =>
        db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

      // 作品メタを先に upsert（冪等）。複数の小チャンク statement を 1 batch に
      // まとめてネットワーク往復を抑える（パラメータ上限は statement 単位なので、
      // batch に小 statement を多数並べるのは安全）。
      await worksRepository(db).upsertAnnictWorks(works);

      const deleteQuery = db
        .delete(watchHistory)
        .where(eq(watchHistory.userId, currentUserId));

      const insertWatchChunk = (
        chunk: Pick<NewWatchHistory, "annictWorkId" | "state">[],
      ) =>
        db.insert(watchHistory).values(
          chunk.map((e) => ({
            userId: currentUserId,
            annictWorkId: e.annictWorkId,
            state: e.state,
            updatedAt: now,
          })),
        );

      // delete + 全 insert チャンクを 1 batch にして全置換をアトミックに行う
      // （delete 後に insert が走り切らず履歴が欠ける窓を作らない）。
      const watchQueries: BatchItem<"sqlite">[] = [deleteQuery];
      for (let i = 0; i < entries.length; i += WATCH_CHUNK) {
        watchQueries.push(insertWatchChunk(entries.slice(i, i + WATCH_CHUNK)));
      }
      await runBatch(watchQueries);

      // 作品メタ（title 等）を含めて返すため annict_works と JOIN する。
      // getMyWatchHistory と同一の射影。
      return db
        .select({
          id: watchHistory.id,
          userId: watchHistory.userId,
          annictWorkId: watchHistory.annictWorkId,
          state: watchHistory.state,
          updatedAt: watchHistory.updatedAt,
          title: annictWorks.title,
          titleKana: annictWorks.titleKana,
          titleEn: annictWorks.titleEn,
          seasonName: annictWorks.seasonName,
          seasonYear: annictWorks.seasonYear,
          imageUrl: annictWorks.imageUrl,
          resolvedImageUrl: annictWorks.resolvedImageUrl,
          imageSource: annictWorks.imageSource,
          imageR2Key: annictWorks.imageR2Key,
        })
        .from(watchHistory)
        .innerJoin(
          annictWorks,
          eq(watchHistory.annictWorkId, annictWorks.annictWorkId),
        )
        .where(eq(watchHistory.userId, currentUserId))
        .orderBy(desc(watchHistory.updatedAt));
    },

    async deleteWatchHistory(annictWorkId: number): Promise<void> {
      await db
        .delete(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, currentUserId),
            eq(watchHistory.annictWorkId, annictWorkId),
          ),
        );
    },
  };
}

export type WatchHistoryRepository = ReturnType<typeof watchHistoryRepository>;
