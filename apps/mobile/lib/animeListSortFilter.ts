// アニメセクション（ライブラリタブ）のソート・絞り込み（issue #346）。
// コンポーネントから切り離した純関数にし、vitest（*.unit.test.ts）で検証する。

// ソートキー。watchersCount は Annict の人気指標（視聴者数）。
export const ANIME_LIST_SORT_KEYS = ["title", "year", "watchersCount"] as const;
export type AnimeListSortKey = (typeof ANIME_LIST_SORT_KEYS)[number];
export type AnimeListSortOrder = "asc" | "desc";

// ソートキーを新たに選んだときの既定の向き。人気順は「多い順」が期待値。
export const ANIME_LIST_SORT_DEFAULT_ORDER: Record<
  AnimeListSortKey,
  AnimeListSortOrder
> = {
  title: "asc",
  year: "asc",
  watchersCount: "desc",
};

// 一覧を開いたときの既定ソート（issue #376: 人気順 = 視聴者数の多い順）。
export const ANIME_LIST_DEFAULT_SORT_KEY: AnimeListSortKey = "watchersCount";
export const ANIME_LIST_DEFAULT_SORT_ORDER: AnimeListSortOrder =
  ANIME_LIST_SORT_DEFAULT_ORDER[ANIME_LIST_DEFAULT_SORT_KEY];

// Annict Work.media の値（メディア種別）。API の searchWorks が返す。
export const ANIME_LIST_MEDIA_KEYS = [
  "TV",
  "MOVIE",
  "OVA",
  "WEB",
  "OTHER",
] as const;
export type AnimeListMedia = (typeof ANIME_LIST_MEDIA_KEYS)[number];

export const ANIME_LIST_MEDIA_LABELS: Record<AnimeListMedia, string> = {
  TV: "TV",
  MOVIE: "映画",
  OVA: "OVA",
  WEB: "Web",
  OTHER: "その他",
};

// ジャンルが未取得（API の genres が null）の作品だけを選ぶ特別な選択肢。
// 実在し得ないキーにしてジャンル名との衝突を避ける。
export const UNKNOWN_GENRE_KEY = "__unknown_genre__";

export type AnimeListFilters = {
  /** null は絞り込まない（すべてのメディア種別）。 */
  media: AnimeListMedia | null;
  /** 空配列は絞り込まない（すべてのジャンル）。複数選択はいずれか一致（OR）。 */
  genres: string[];
};

export const NO_ANIME_LIST_FILTERS: AnimeListFilters = {
  media: null,
  genres: [],
};

// 絞り込みの入力に必要な最小限のフィールド。
type AnimeListFilterEntry = {
  // API（Annict searchWorks）が返すメディア種別。取らない経路では undefined。
  media?: string | null;
  // annict_works.genres。null は未取得（「不明」）、
  // 空配列は取得済みだが供給元にも無い確定値。
  genres: string[] | null;
};

// ソートの入力に必要な最小限のフィールド。
type AnimeListSortEntry = {
  title: string;
  seasonYear: number | null;
  watchersCount?: number | null;
};

export function isAnimeListFilterActive(filters: AnimeListFilters): boolean {
  return filters.media !== null || filters.genres.length > 0;
}

/** 有効な絞り込み条件の数（メディア 1 + ジャンル選択数）。 */
export function animeListFilterCount(filters: AnimeListFilters): number {
  return (filters.media !== null ? 1 : 0) + filters.genres.length;
}

/**
 * ジャンル絞り込みの選択肢を一覧に出る作品から作る（存在しないジャンルを
 * 出さない）。出現するジャンルを件数の多い順（同数は名前順）に並べ、
 * ジャンルが未取得の作品があるときだけ末尾に「不明」を足す。
 */
export function collectAnimeGenres(items: AnimeListFilterEntry[]): string[] {
  const counts = new Map<string, number>();
  let hasUnknown = false;
  for (const item of items) {
    if (item.genres == null) {
      hasUnknown = true;
      continue;
    }
    for (const genre of item.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
    .map(([genre]) => genre);
  return hasUnknown ? [...sorted, UNKNOWN_GENRE_KEY] : sorted;
}

/** 絞り込みを適用した一覧を返す。フィルタ無効時は入力をそのまま返す。 */
export function filterAnimeList<T extends AnimeListFilterEntry>(
  items: T[],
  filters: AnimeListFilters,
): T[] {
  const genres = filters.genres.length > 0 ? new Set(filters.genres) : null;
  return items.filter((item) => {
    // media を持たない作品（取得経路違い）はメディア絞り込みでは落ちる。
    if (filters.media !== null && item.media !== filters.media) return false;
    if (!genres) return true;
    // ジャンル未取得（null）は「不明」の選択にだけ一致する。
    // genres=[]（取得済み・供給元にも無い）はどのジャンルにも一致しない。
    if (item.genres == null) return genres.has(UNKNOWN_GENRE_KEY);
    return item.genres.some((genre) => genres.has(genre));
  });
}

/**
 * ソートを適用した一覧を返す。watchersCount（人気順）は未取得（null）の
 * 作品を末尾に寄せる（「人気不明」が最人気・最不人気に紛れないようにする）。
 */
export function sortAnimeList<T extends AnimeListSortEntry>(
  items: T[],
  sortKey: AnimeListSortKey,
  sortOrder: AnimeListSortOrder,
): T[] {
  return [...items].sort((a, b) => {
    if (sortKey === "watchersCount") {
      const av = a.watchersCount ?? null;
      const bv = b.watchersCount ?? null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortOrder === "asc" ? av - bv : bv - av;
    }
    const cmp =
      sortKey === "title"
        ? a.title.localeCompare(b.title, "ja")
        : (a.seasonYear ?? 0) - (b.seasonYear ?? 0);
    return sortOrder === "asc" ? cmp : -cmp;
  });
}
