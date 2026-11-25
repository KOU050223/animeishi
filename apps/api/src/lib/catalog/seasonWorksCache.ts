// シーズン検索（searchWorks(seasons:) の全ページ取得結果）のキャッシュ。
// シーズン内の作品一覧は全ユーザー共通で変化が緩いため、全ページ走査
// （直列の複数サブリクエスト）の結果をシーズン単位で共有し、Annict への負荷と
// 初回表示の遅延を削る（issue #163 / #173）。
import type { AnnictLibraryEntry } from "#src/lib/annict/client/index";
import { readWorkCache, workCacheUrl, writeWorkCache } from "./workSearchCache";

// キャッシュ鮮度。シーズン中盤の追加作品や watchers 順位変動への追従と、
// Annict 負荷・応答速度のバランスで 30 分に設定。
const SEASON_WORKS_CACHE_TTL_MS = 30 * 60 * 1000;

export function seasonWorksCacheUrl(season: string): string {
  return workCacheUrl(`season-works/${encodeURIComponent(season)}`);
}

/** キャッシュ済みのシーズン作品一覧を返す。未命中・期限切れなら null。 */
export function readSeasonWorksCache(
  season: string,
): Promise<AnnictLibraryEntry[] | null> {
  return readWorkCache<AnnictLibraryEntry[]>(
    seasonWorksCacheUrl(season),
    SEASON_WORKS_CACHE_TTL_MS,
  );
}

/** シーズン作品一覧をキャッシュに書き込む。 */
export function writeSeasonWorksCache(
  season: string,
  works: AnnictLibraryEntry[],
): Promise<void> {
  return writeWorkCache(
    seasonWorksCacheUrl(season),
    works,
    SEASON_WORKS_CACHE_TTL_MS,
  );
}
