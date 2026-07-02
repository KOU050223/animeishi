export type MeishiAnimeContextSource = {
  favorites?: { imageUrl: string | null }[];
  watchHistory?: { state: string | null; imageUrl: string | null }[];
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

function compactImageUrls(items: { imageUrl: string | null }[]): string[] {
  return items.flatMap((item) => (item.imageUrl ? [item.imageUrl] : []));
}
