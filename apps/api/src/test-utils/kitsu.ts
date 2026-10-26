// Kitsu の JSON:API（mappings / 作品のキャラクター一覧）のモック応答を組み立てる
// テスト用ヘルパー。画像フォールバック系（lib/annict/*Fallback.ts）の
// 各テストから共有する。

export const KITSU_MAPPINGS_URL_PREFIX = "https://kitsu.io/api/edge/mappings";
export const KITSU_ANIME_URL_PREFIX = "https://kitsu.io/api/edge/anime/";
export const KITSU_ANIME_LIST_URL = "https://kitsu.io/api/edge/anime";

/** fetch の URL が Kitsu の mappings API か。 */
export function isKitsuMappingsUrl(url: string): boolean {
  return url.startsWith(KITSU_MAPPINGS_URL_PREFIX);
}

/** fetch の URL が Kitsu の作品一覧 API（/anime?filter[id]=...）か。 */
export function isKitsuAnimeListUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}` === KITSU_ANIME_LIST_URL;
  } catch {
    return false;
  }
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

/**
 * Kitsu の /anime?filter[id]=... の JSON:API 応答を組み立てる。
 * キーは Kitsu 作品 ID（文字列）。値が null の ID はポスター無しの作品、
 * キー自体を書かなければ「Kitsu にその作品が無い」応答になる。
 */
export function makeKitsuAnimeListResponse(
  posters: Record<string, string | null>,
): Response {
  const data = Object.entries(posters).map(([kitsuId, poster]) => ({
    id: kitsuId,
    type: "anime",
    attributes: { posterImage: poster ? { large: poster } : null },
  }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

/** fetch の URL が Kitsu の作品 characters API（/anime/<id>/characters）か。 */
export function isKitsuCharactersUrl(url: string): boolean {
  if (!url.startsWith(KITSU_ANIME_URL_PREFIX)) return false;
  try {
    return new URL(url).pathname.endsWith("/characters");
  } catch {
    return false;
  }
}

type KitsuCharacterEntry = {
  id: string;
  canonicalName?: string | null;
  /** names オブジェクト（en / ja_jp 等の言語キー → 名前）。 */
  names?: Record<string, string | null> | null;
  otherNames?: (string | null)[] | null;
  image?: {
    large?: string | null;
    original?: string | null;
    medium?: string | null;
    small?: string | null;
  } | null;
};

/**
 * Kitsu の /anime/<id>/characters?include=character の JSON:API 応答を組み立てる。
 * data は mediaCharacters 行（character 参照）、included に characters を載せる。
 * next を渡すと links.next にその URL を置く（ページングのテスト用）。
 */
export function makeKitsuCharactersResponse(
  characters: KitsuCharacterEntry[],
  next: string | null = null,
): Response {
  const data = characters.map((c) => ({
    id: `mc-${c.id}`,
    type: "mediaCharacters",
    relationships: {
      character: { data: { type: "characters", id: c.id } },
    },
  }));
  const included = characters.map((c) => ({
    id: c.id,
    type: "characters",
    attributes: {
      canonicalName: c.canonicalName ?? null,
      name: c.canonicalName ?? null,
      names: c.names ?? null,
      otherNames: c.otherNames ?? [],
      image: c.image ?? null,
    },
  }));
  return new Response(
    JSON.stringify({
      data,
      included,
      links: next ? { next } : {},
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/vnd.api+json" },
    },
  );
}
