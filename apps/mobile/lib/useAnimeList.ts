import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export type AnimeTitle = {
  annictWorkId: number;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  imageUrl: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  updatedAt: string;
};

export type SortKey = "title" | "year";
export type SortOrder = "asc" | "desc";

export const ANIME_LIST_QUERY_KEY = ["titles"] as const;

export function useAnimeList() {
  return useQuery({
    queryKey: ANIME_LIST_QUERY_KEY,
    enabled: false,
    queryFn: async (): Promise<AnimeTitle[]> => [],
  });
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase();
}

export function useFilteredAnimeList(
  data: AnimeTitle[] | undefined,
  query: string,
  sortKey: SortKey,
  sortOrder: SortOrder,
) {
  return useMemo(() => {
    if (!data) return [];

    const q = normalizeText(query.trim());
    const filtered = q
      ? data.filter(
          (a) =>
            normalizeText(a.title).includes(q) ||
            normalizeText(a.titleKana ?? "").includes(q) ||
            normalizeText(a.titleEn ?? "").includes(q),
        )
      : data;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title, "ja");
      } else {
        cmp = (a.seasonYear ?? 0) - (b.seasonYear ?? 0);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [data, query, sortKey, sortOrder]);
}
