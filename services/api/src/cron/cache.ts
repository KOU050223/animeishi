/**
 * Cloudflare Cache Purge 処理。
 *
 * バッチでアニメマスターを更新したあと、ユーザーに古いデータが返り続けないよう
 * キャッシュを破棄する。2 系統のキャッシュを対象にする:
 *   1. Cloudflare ゾーンのエッジキャッシュ（REST API: purge_cache）
 *   2. Worker 内の Cache API に保存した /titles のレスポンス
 */

/** Cache Purge に必要な環境変数（バインディング）。 */
export type CachePurgeEnv = {
  /** Cloudflare API トークン（Zone.Cache Purge 権限）。未設定ならゾーンパージはスキップ。 */
  CLOUDFLARE_API_TOKEN?: string;
  /** パージ対象ゾーン ID。未設定ならゾーンパージはスキップ。 */
  CLOUDFLARE_ZONE_ID?: string;
};

/** titles ルートが Cache API に保存しているキャッシュキー（route と一致させる）。 */
export const TITLES_CACHE_KEY = "https://animeishi.internal/cache/titles";

export type CachePurgeResult = {
  /** ゾーンのエッジキャッシュをパージしたか */
  zonePurged: boolean;
  /** Worker Cache API のエントリを削除できたか */
  edgeCachePurged: boolean;
};

/**
 * Cloudflare ゾーンのキャッシュ全体をパージする。
 * 認証情報が未設定の場合は何もせず false を返す（ローカル開発で安全に動かすため）。
 */
export async function purgeZoneCache(env: CachePurgeEnv): Promise<boolean> {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = env;
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
    return false;
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purge_everything: true }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Cloudflare Cache Purge に失敗しました (status=${res.status}): ${detail}`,
    );
  }
  return true;
}

/**
 * Worker の Cache API に保存された /titles のレスポンスを削除する。
 * Cache API が利用できない環境（一部のテスト）では false を返す。
 */
export async function purgeTitlesEdgeCache(): Promise<boolean> {
  const cacheStore = (caches as unknown as { default?: Cache }).default;
  if (!cacheStore) {
    return false;
  }
  return cacheStore.delete(new Request(TITLES_CACHE_KEY));
}

/** ゾーンキャッシュと /titles キャッシュの両方をパージする。 */
export async function purgeAnimeCaches(
  env: CachePurgeEnv,
): Promise<CachePurgeResult> {
  const [zonePurged, edgeCachePurged] = await Promise.all([
    purgeZoneCache(env),
    purgeTitlesEdgeCache(),
  ]);
  return { zonePurged, edgeCachePurged };
}
