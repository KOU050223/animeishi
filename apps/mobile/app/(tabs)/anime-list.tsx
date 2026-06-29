import { AnimeListContent } from "@/components/anime-list";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";

export default function AnimeListScreen() {
  const favoriteIds = useFavoriteIds();
  const { toggle, isPending: isToggling } = useToggleFavorite(favoriteIds);

  return (
    <AnimeListContent
      favoriteIds={favoriteIds}
      toggleFavorite={toggle}
      isToggling={isToggling}
    />
  );
}
