import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { PickImageUrlInput } from "@/lib/anime/pickImageUrl";

export type MeishiAnimeContextSource = {
  favorites?: PickImageUrlInput[];
  watchHistory?: (PickImageUrlInput & { state: string | null })[];
};

export function buildMeishiAnimeContext(source: MeishiAnimeContextSource) {
  const favorites = source.favorites ?? [];
  const watchHistory = source.watchHistory ?? [];
  const watchHistoryImages = compactImageUrls(watchHistory);
  const favoriteImages = compactImageUrls(favorites);

  return {
    animeCollageImages:
      watchHistoryImages.length > 0 ? watchHistoryImages : favoriteImages,
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
