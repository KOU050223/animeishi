import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";

export type SortKey = "title" | "year";
export type SortOrder = "asc" | "desc";

export const ANIME_LIST_QUERY_KEY = ["titles"] as const;

export function useAnimeList() {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ANIME_LIST_QUERY_KEY,
    queryFn: async () => {
      const token = await getToken();
      const res = await apiClient.titles.$get(
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("アニメ一覧の取得に失敗しました");
      return res.json();
    },
  });
}

export function useFilteredAnimeList(
  data: Awaited<ReturnType<ReturnType<typeof useAnimeList>["refetch"]>>["data"],
  query: string,
  sortKey: SortKey,
  sortOrder: SortOrder
) {
  return useMemo(() => {
    if (!data) return [];

    const q = query.trim().toLowerCase();
    const filtered = q
      ? data.filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            (a.titleReading ?? "").toLowerCase().includes(q) ||
            (a.titleEnglish ?? "").toLowerCase().includes(q)
        )
      : data;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title, "ja");
      } else {
        cmp = (a.year ?? 0) - (b.year ?? 0);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [data, query, sortKey, sortOrder]);
}
