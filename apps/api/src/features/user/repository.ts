import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  annictWorks,
  episodeRecords,
  favorites,
  watchHistory,
} from "@/db/schema";
import type { WatchHistory } from "@/db/schema";

/** 公開名刺（/user/:uid の OGP / JSON）に載せる視聴サマリ。 */
export type UserWatchSummary = {
  /** 視聴済み（WATCHED）の作品数。 */
  watchedCount: number;
  /** 視聴中（WATCHING）の作品数。 */
  watchingCount: number;
  /** 見たい（WANNA_WATCH）の作品数。 */
  wannaWatchCount: number;
  /** お気に入り登録した作品数。 */
  favoriteCount: number;
  /** 最近お気に入りにした作品タイトル（新しい順・最大 FAVORITE_TITLES_MAX 件）。 */
  favoriteTitles: string[];
  /**
   * D1 キャッシュの最終更新時刻。null はキャッシュ未作成（視聴履歴も
   * お気に入りも 0 件）。
   */
  syncedAt: Date | null;
};

// OGP に列挙するお気に入り作品タイトルの上限。名刺として読める件数に抑える。
const FAVORITE_TITLES_MAX = 3;

/**
 * /user/:uid の公開名刺に載せる視聴サマリを D1 キャッシュから集計する
 * （issue #65）。
 *
 * 他人の Annict トークンは取得できないため、watch_history / favorites は
 * 「本人が最後に一覧を開いた時点のスナップショット」になる（docs/05 参照）。
 * 公開制御（isPublic・ブロック判定）はルート側で済ませてから呼ぶ前提。
 * 中断・保留中（ON_HOLD / STOP_WATCHING）は名刺の訴求に使わないため集計しない。
 */
export async function findUserWatchSummary(
  db: DrizzleDb,
  userId: string,
): Promise<UserWatchSummary> {
  // 無認証でクローラー流量を受ける公開エンドポイントのため、3 クエリを
  // db.batch で 1 往復にまとめる。
  // updated_at / created_at は unix 秒（drizzle timestamp mode）。max() を
  // 通した値は Date 変換されず生の秒値で返るため、受け取ってから変換する。
  const [stateRows, favoriteAggregate, favoriteTitleRows] = await db.batch([
    db
      .select({
        state: watchHistory.state,
        count: sql<number>`count(*)`,
        latest: sql<number | null>`max(${watchHistory.updatedAt})`,
      })
      .from(watchHistory)
      .where(eq(watchHistory.userId, userId))
      .groupBy(watchHistory.state),
    db
      .select({
        count: sql<number>`count(*)`,
        latest: sql<number | null>`max(${favorites.createdAt})`,
      })
      .from(favorites)
      .where(eq(favorites.userId, userId)),
    db
      .select({ title: annictWorks.title })
      .from(favorites)
      .innerJoin(
        annictWorks,
        eq(favorites.annictWorkId, annictWorks.annictWorkId),
      )
      .where(eq(favorites.userId, userId))
      // created_at は秒精度で同秒があり得るため、id で順序を決定的にする。
      .orderBy(desc(favorites.createdAt), desc(favorites.id))
      .limit(FAVORITE_TITLES_MAX),
  ]);

  const countOf = (state: WatchHistory["state"]) =>
    stateRows.find((r) => r.state === state)?.count ?? 0;

  const syncedAtSec = Math.max(
    0,
    ...stateRows.map((r) => r.latest ?? 0),
    favoriteAggregate[0]?.latest ?? 0,
  );

  return {
    watchedCount: countOf("WATCHED"),
    watchingCount: countOf("WATCHING"),
    wannaWatchCount: countOf("WANNA_WATCH"),
    favoriteCount: favoriteAggregate[0]?.count ?? 0,
    favoriteTitles: favoriteTitleRows.map((r) => r.title),
    syncedAt: syncedAtSec > 0 ? new Date(syncedAtSec * 1000) : null,
  };
}

/** 「いま見ている」吹き出し（issue #420）に載せる直近の話数記録 1 件。 */
export type NowWatching = {
  annictWorkId: number;
  annictEpisodeId: number;
  title: string;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  /** Annict 側の記録日時（episode_records.recorded_at）。 */
  recordedAt: Date;
};

// 吹き出しに出す記録の鮮度。24 時間より古い記録しか無ければ出さない
// （「一定時間で消える」の期限）。
const NOW_WATCHING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ユーザーの直近 24 時間の話数記録（episode_records）から最新 1 件を返す
 * （issue #420）。無ければ null。
 *
 * 公開制御（isPublic・ブロック判定）はルート側で済ませてから呼ぶ前提。
 * 話の番号（"第3話" 等の numberText）は D1 に持たないため、話数表示は
 * annictEpisodeId からクライアント側で話数マスタを引いて解決する。
 */
export async function findNowWatching(
  db: DrizzleDb,
  userId: string,
): Promise<NowWatching | null> {
  const since = new Date(Date.now() - NOW_WATCHING_WINDOW_MS);
  const rows = await db
    .select({
      annictWorkId: episodeRecords.annictWorkId,
      annictEpisodeId: episodeRecords.annictEpisodeId,
      title: annictWorks.title,
      titleEn: annictWorks.titleEn,
      seasonName: annictWorks.seasonName,
      seasonYear: annictWorks.seasonYear,
      recordedAt: episodeRecords.recordedAt,
    })
    .from(episodeRecords)
    .innerJoin(
      annictWorks,
      eq(episodeRecords.annictWorkId, annictWorks.annictWorkId),
    )
    .where(
      and(
        eq(episodeRecords.userId, userId),
        gt(episodeRecords.recordedAt, since),
      ),
    )
    // recorded_at は秒精度で同秒があり得るため、id で順序を決定的にする。
    .orderBy(desc(episodeRecords.recordedAt), desc(episodeRecords.id))
    .limit(1);
  return rows[0] ?? null;
}
