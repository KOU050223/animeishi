import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { PickImageUrlInput } from "@/lib/anime/pickImageUrl";
import type { CollageStateFilter } from "./types";

export type MeishiAnimeContextSource = {
  favorites?: PickImageUrlInput[];
  watchHistory?: (PickImageUrlInput & { state: string | null })[];
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
    const url = pickImageUrl(item);
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

function compactImageUrls(items: PickImageUrlInput[]): string[] {
  return items.flatMap((item) => {
    const url = pickImageUrl(item);
    return url ? [url] : [];
  });
}
