import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";

type FavoritesResponse = InferResponseType<
  (typeof apiClient.me.favorites)["$get"],
  200
>;
export type FavoriteItem = FavoritesResponse[number];

export const FAVORITES_QUERY_KEY = ["favorites"] as const;

const favoritesQueryKey = (userId: string) =>
  [...FAVORITES_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * お気に入りトグル時に「追加すべきか削除すべきか」を判定する純粋関数。
 * UI から切り離してテスト可能にするために分離している。
 */
export function nextFavoriteAction(
  favoriteIds: Set<number>,
  annictWorkId: number,
): "add" | "remove" {
  return favoriteIds.has(annictWorkId) ? "remove" : "add";
}

export function useFavorites() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? favoritesQueryKey(userId) : FAVORITES_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.favorites.$get({}, { headers });
      if (!res.ok) throw new Error("お気に入りの取得に失敗しました");
      return res.json();
    },
  });
}

/**
 * お気に入り annictWorkId の Set を返す。トグル UI で「登録済みか」を高速判定するためのヘルパー。
 */
export function useFavoriteIds(): Set<number> {
  const { data } = useFavorites();
  return useMemo(
    () => new Set((data ?? []).map((f) => f.annictWorkId)),
    [data],
  );
}

export function useAddFavorite() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.favorites[":annictWorkId"].$post(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers },
      );
      if (!res.ok) throw new Error("お気に入りの追加に失敗しました");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? favoritesQueryKey(userId) : FAVORITES_QUERY_KEY,
      });
    },
  });
}

export function useRemoveFavorite() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.favorites[":annictWorkId"].$delete(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers },
      );
      if (!res.ok) throw new Error("お気に入りの削除に失敗しました");
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? favoritesQueryKey(userId) : FAVORITES_QUERY_KEY,
      });
    },
  });
}

/**
 * お気に入り登録状態をトグルする。登録済みなら削除、未登録なら追加。
 * 呼び出し側で既に取得済みの `favoriteIds` を渡すことで、
 * 同一データの派生計算（Set 生成）が重複するのを避ける。
 */
export function useToggleFavorite(favoriteIds: Set<number>) {
  const add = useAddFavorite();
  const remove = useRemoveFavorite();

  return {
    toggle: (annictWorkId: number) => {
      if (nextFavoriteAction(favoriteIds, annictWorkId) === "remove") {
        remove.mutate(annictWorkId);
      } else {
        add.mutate(annictWorkId);
      }
    },
    isPending: add.isPending || remove.isPending,
  };
}
