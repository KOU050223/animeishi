import { desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  annictWorks,
  favorites,
  watchHistory,
  type WatchHistory,
} from "@/db/schema";

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
  // updated_at / created_at は unix 秒（drizzle timestamp mode）。max() を
  // 通した値は Date 変換されず生の秒値で返るため、受け取ってから変換する。
  const stateRows = await db
    .select({
      state: watchHistory.state,
      count: sql<number>`count(*)`,
      latest: sql<number | null>`max(${watchHistory.updatedAt})`,
    })
    .from(watchHistory)
    .where(eq(watchHistory.userId, userId))
    .groupBy(watchHistory.state);

  const favoriteAggregate = await db
    .select({
      count: sql<number>`count(*)`,
      latest: sql<number | null>`max(${favorites.createdAt})`,
    })
    .from(favorites)
    .where(eq(favorites.userId, userId));

  const favoriteTitleRows = await db
    .select({ title: annictWorks.title })
    .from(favorites)
    .innerJoin(
      annictWorks,
      eq(favorites.annictWorkId, annictWorks.annictWorkId),
    )
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt))
    .limit(FAVORITE_TITLES_MAX);

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
