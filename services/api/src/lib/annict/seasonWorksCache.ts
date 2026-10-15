// シーズン検索（searchWorks(seasons:) の全ページ取得結果）を Workers Cache API
// にキャッシュする。シーズン内の作品一覧は全ユーザー共通で変化が緩いため、
// 全ページ走査（直列の複数サブリクエスト）の結果をシーズン単位で共有し、
// Annict への負荷と初回表示の遅延を削る（issue #163 / #173）。
//
// D1 ではなく Cache API を選んだのは「無くても動く揮発キャッシュ」で十分であり、
// スキーマ変更・バインディング追加なしで使えるため。colo 単位のキャッシュなので
// 全インスタンスで共有されるわけではないが、同条件の連続リクエスト
// （画像補完ポーリング等）や同じ colo の別ユーザーを捌くには十分効く。
import type { AnnictLibraryEntry } from "./client";

// キャッシュ鮮度。シーズン中盤の追加作品や watchers 順位変動への追従と、
// Annict 負荷・応答速度のバランスで 30 分に設定。
export const SEASON_WORKS_CACHE_TTL_MS = 30 * 60 * 1000;

type SeasonWorksCachePayload = {
  fetchedAt: number;
  works: AnnictLibraryEntry[];
};

// Cache API のキーは Request/URL でしか指定できないため、実在しない内部オリジンに
// シーズンを載せた URL をキーにする。
export function seasonWorksCacheUrl(season: string): string {
  return `https://cache.internal/annict/season-works/${encodeURIComponent(season)}`;
}

// Workers では caches.default が既定キャッシュ。ブラウザの DOM CacheStorage には
// default が無く、本ファイルは mobile 側の型検査（AppType 経由）でも検査対象に
// なるため、構造的に取り出す。caches 自体が無い環境では例外を投げるため、
// 呼び出し側の try/catch で未命中に畳む。
function defaultCache(): Cache | null {
  const storage = caches as CacheStorage & { default?: Cache };
  return storage.default ?? null;
}

/**
 * キャッシュ済みのシーズン作品一覧を返す。未命中・期限切れ・キャッシュ不可
 * （Cache API の無い実行環境やペイロード破損）の場合は null。
 * キャッシュの失敗で検索自体を落とさないため、すべての例外は未命中に畳む。
 */
export async function readSeasonWorksCache(
  season: string,
): Promise<AnnictLibraryEntry[] | null> {
  try {
    const cache = defaultCache();
    if (!cache) return null;
    const res = await cache.match(seasonWorksCacheUrl(season));
    if (!res) return null;
    const payload = (await res.json()) as SeasonWorksCachePayload;
    // 鮮度は Cache-Control 任せにせず payload 内の時刻でも自前判定する
    // （実行環境による鮮度管理の差異を吸収するため）。
    if (Date.now() - payload.fetchedAt > SEASON_WORKS_CACHE_TTL_MS) return null;
    return payload.works;
  } catch {
    return null;
  }
}

/**
 * シーズン作品一覧をキャッシュに書き込む。
 * 書き込み失敗は検索レスポンスを壊さないよう握りつぶす。
 */
export async function writeSeasonWorksCache(
  season: string,
  works: AnnictLibraryEntry[],
): Promise<void> {
  try {
    const cache = defaultCache();
    if (!cache) return;
    const payload: SeasonWorksCachePayload = { fetchedAt: Date.now(), works };
    await cache.put(
      seasonWorksCacheUrl(season),
      new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${Math.floor(SEASON_WORKS_CACHE_TTL_MS / 1000)}`,
        },
      }),
    );
  } catch {
    // キャッシュ不能な環境でも検索は継続させる。
  }
}
