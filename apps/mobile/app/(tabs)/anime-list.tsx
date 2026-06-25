import { AnimeListContent } from "@/components/anime-list";
import { useAnimeList } from "@/lib/useAnimeList";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";

export default function AnimeListScreen() {
  const { data, isLoading, isError, refetch } = useAnimeList();
  const favoriteIds = useFavoriteIds();
  const { toggle, isPending: isToggling } = useToggleFavorite(favoriteIds);

  return (
    <AnimeListContent
      data={data}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      favoriteIds={favoriteIds}
      toggleFavorite={toggle}
      isToggling={isToggling}
    />
  );
}
