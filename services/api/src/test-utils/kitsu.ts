// Kitsu の mappings API（MAL ID → Kitsu 作品）のモック応答を組み立てるテスト用ヘルパー。
// 画像フォールバック（lib/annict/imageFallback.ts）の各テストから共有する。

export const KITSU_MAPPINGS_URL_PREFIX = "https://kitsu.io/api/edge/mappings";

/** fetch の URL が Kitsu の mappings API か。 */
export function isKitsuMappingsUrl(url: string): boolean {
  return url.startsWith(KITSU_MAPPINGS_URL_PREFIX);
}

/** Kitsu mappings への問い合わせ URL から、問い合わせた MAL ID 一覧を取り出す。 */
export function kitsuRequestedMalIds(url: string): number[] {
  const raw = new URL(url).searchParams.get("filter[externalId]") ?? "";
  return raw.split(",").filter(Boolean).map(Number);
}

type KitsuEntry = {
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
    medium?: string | null;
  } | null;
} | null;

/**
 * `m<malId>` をキーにした「その作品のポスター」から Kitsu の JSON:API 応答を作る。
 * 値が null の key は「Kitsu に無い」= 応答に含めない。
 * 旧 AniList モックと同じ入力形（coverImage）を受け、Kitsu の posterImage に変換する。
 */
export function makeKitsuResponse(
  entries: Record<string, KitsuEntry>,
): Response {
  const data: unknown[] = [];
  const included: unknown[] = [];
  for (const [key, node] of Object.entries(entries)) {
    if (!node) continue;
    const malId = key.slice(1);
    const kitsuId = `k${malId}`;
    const poster =
      node.coverImage?.extraLarge ??
      node.coverImage?.large ??
      node.coverImage?.medium ??
      null;
    data.push({
      id: `map-${malId}`,
      type: "mappings",
      attributes: { externalSite: "myanimelist/anime", externalId: malId },
      relationships: { item: { data: { id: kitsuId, type: "anime" } } },
    });
    included.push({
      id: kitsuId,
      type: "anime",
      attributes: { posterImage: poster ? { large: poster } : null },
    });
  }
  return new Response(JSON.stringify({ data, included }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}
