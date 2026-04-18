import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { AnimeTitle } from "@/db/schema";
import { apiClient } from "@/lib/api";

export type { AnimeTitle };

export type SortKey = "title" | "year";
export type SortOrder = "asc" | "desc";

export const ANIME_LIST_QUERY_KEY = ["titles"] as const;

export function useAnimeList() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ANIME_LIST_QUERY_KEY,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (await (apiClient as any).titles.$get(
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )) as Response;
      if (!res.ok) throw new Error("アニメ一覧の取得に失敗しました");
      return res.json() as Promise<AnimeTitle[]>;
    },
  });
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    )
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
            normalizeText(a.titleReading ?? "").includes(q) ||
            normalizeText(a.titleEnglish ?? "").includes(q),
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
