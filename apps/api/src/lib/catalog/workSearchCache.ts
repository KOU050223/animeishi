// Annict の作品情報（全ユーザー共通のデータ）を Workers Cache API に短期キャッシュする。
// シーズン検索（seasonWorksCache.ts）・タイトル検索・共用トークン経路の作品詳細
// （issue #561）で共有する読み書きの土台。
//
// D1 ではなく Cache API を選んだのは「無くても動く揮発キャッシュ」で十分であり、
// スキーマ変更・バインディング追加なしで使えるため。colo 単位のキャッシュなので
// 全インスタンスで共有されるわけではないが、同条件の連続リクエストや同じ colo の
// 別ユーザーを捌くには十分効く。
//
// 利用者ごとに異なる値（viewerStatusState 等）を含む応答はキャッシュしないこと。
// キーが利用者を区別しないため、別の利用者に漏れる。

type CachePayload<T> = {
  fetchedAt: number;
  value: T;
};

// Cache API のキーは Request/URL でしか指定できないため、実在しない内部オリジンの
// URL をキーにする。
export function workCacheUrl(path: string): string {
  return `https://cache.internal/annict/${path}`;
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
 * キャッシュ済みの値を返す。未命中・期限切れ・キャッシュ不可（Cache API の無い
 * 実行環境やペイロード破損）の場合は null。キャッシュの失敗で本処理を
 * 落とさないため、すべての例外は未命中に畳む。
 */
export async function readWorkCache<T>(
  url: string,
  ttlMs: number,
): Promise<T | null> {
  try {
    const cache = defaultCache();
    if (!cache) return null;
    const res = await cache.match(url);
    if (!res) return null;
    const payload = (await res.json()) as CachePayload<T>;
    // 鮮度は Cache-Control 任せにせず payload 内の時刻でも自前判定する
    // （実行環境による鮮度管理の差異を吸収するため）。
    if (Date.now() - payload.fetchedAt > ttlMs) return null;
    // 形の違う旧ペイロード（value を持たない）も未命中に畳む。
    return payload.value ?? null;
  } catch {
    return null;
  }
}

/** 値をキャッシュに書き込む。書き込み失敗は本処理を壊さないよう握りつぶす。 */
export async function writeWorkCache<T>(
  url: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  try {
    const cache = defaultCache();
    if (!cache) return;
    const payload: CachePayload<T> = { fetchedAt: Date.now(), value };
    await cache.put(
      url,
      new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${Math.floor(ttlMs / 1000)}`,
        },
      }),
    );
  } catch {
    // キャッシュ不能な環境でも本処理は継続させる。
  }
}
