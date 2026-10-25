import type { CollageStateFilter } from "./types";

// コラージュに並べる作品画像は作品画像プロキシの URL だけを使う（issue #224）。
type WorkImageSource = { hostedImageUrl?: string | null };

export type MeishiAnimeContextSource = {
  favorites?: WorkImageSource[];
  watchHistory?: (WorkImageSource & { state: string | null })[];
};

export function buildMeishiAnimeContext(source: MeishiAnimeContextSource) {
  const favorites = source.favorites ?? [];
  const watchHistory = source.watchHistory ?? [];
  const watchHistoryImages = compactImageUrls(watchHistory);
  const favoriteImages = compactImageUrls(favorites);

  // コラージュの「リスト選択・ステータス絞り込み」（issue #96）用に、
  // ステータス別の画像 URL 集合も組み立てる。
  const byState: Partial<Record<Exclude<CollageStateFilter, "all">, string[]>> =
    {};
  for (const item of watchHistory) {
    const url = item.hostedImageUrl;
    if (!item.state || !url) continue;
    const key = item.state as Exclude<CollageStateFilter, "all">;
    (byState[key] ??= []).push(url);
  }

  return {
    animeCollageImages:
      watchHistoryImages.length > 0 ? watchHistoryImages : favoriteImages,
    animeLists: {
      watchHistory: watchHistoryImages,
      favorites: favoriteImages,
      byState,
    },
    favoritesCount: favorites.length,
    watchedCount: watchHistory.filter((item) => item.state === "WATCHED")
      .length,
  };
}

function compactImageUrls(items: WorkImageSource[]): string[] {
  return items.flatMap((item) =>
    item.hostedImageUrl ? [item.hostedImageUrl] : [],
  );
}
