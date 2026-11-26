import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { hiraganaToKana } from "@/lib/textNormalize";
import { invalidateCommonPoints } from "@/features/users/useCommonPoints";
import { favoriteQueries, type FavoriteItem } from "@/lib/queries/favorites";

export type { FavoriteItem };

const FAVORITES_QUERY_KEY = favoriteQueries.all;

const favoritesQueryKey = (userId: string) => favoriteQueries.key(userId);

/**
 * お気に入り検索の対象フィールド。title / titleKana / titleEn のいずれかにクエリがマッチすれば true を返す。
 */
export function matchesFavoriteQuery(
  favorite: Pick<FavoriteItem, "title" | "titleKana" | "titleEn">,
  query: string,
): boolean {
  // クエリを正規化する
  // 大文字小文字を無視するためにクエリを正規化
  // ひらがな/カタカナを正規化して一致させる
  const normalizedQuery = query.toLowerCase();
  const normalizedTitleKana = hiraganaToKana(query);

  // 部分一致でマッチするか判定する
  return (
    favorite.title.toLowerCase().includes(normalizedQuery) ||
    (favorite.titleEn ?? "").toLowerCase().includes(normalizedQuery) ||
    (favorite.titleKana ?? "").includes(normalizedTitleKana)
  );
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
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...favoriteQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * お気に入り annictWorkId の Set を返す。トグル UI で「登録済みか」を高速判定するためのヘルパー。
 */
export function useFavoriteIds(): Set<number> {
  const { data } = useFavorites();
  // AnimeListContent の FlatList#renderItem（固定するコールバック）の依存に
  // 入るため参照を固定する。
  return useMemo(
    () => new Set((data ?? []).map((f) => f.annictWorkId)),
    [data],
  );
}

export function useAddFavorite() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      // 検索結果（未キャッシュ作品）からの追加では、API が searchWorks で作品を
      // 解決するため Annict トークンが要る。native は連携済みならヘッダで付与し、
      // Web はサーバー(D1)側で解決される。キャッシュ済み作品ならトークン無しでも追加可。
      const res = await apiClient.me.favorites[":annictWorkId"].$post(
        { param: { annictWorkId: String(annictWorkId) } },
        {
          fetch: apiFetch({
            annict: true,
            errorMessage: "推しの登録に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      invalidateCommonPoints(queryClient);
      void queryClient.invalidateQueries({
        queryKey: userId ? favoritesQueryKey(userId) : FAVORITES_QUERY_KEY,
      });
    },
  });
}

export function useRemoveFavorite() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annictWorkId: number) => {
      // 解除は Annict 照合を伴わないため Annict ヘッダは付けない
      // （移行前のヘッダ構成を維持）。
      const res = await apiClient.me.favorites[":annictWorkId"].$delete(
        { param: { annictWorkId: String(annictWorkId) } },
        { fetch: apiFetch({ errorMessage: "推しの解除に失敗しました" }) },
      );
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onSuccess: () => {
      invalidateCommonPoints(queryClient);
      void queryClient.invalidateQueries({
        queryKey: userId ? favoritesQueryKey(userId) : FAVORITES_QUERY_KEY,
      });
    },
  });
}

/**
 * お気に入り登録状態をトグルする。登録済みなら削除、未登録なら追加。
 * 呼び出し側で既に取得済みの `favoriteIds` を渡すことで、
 * 同一データの派生計算（Set 生成）が重複するのを避ける。
 *
 * 失敗時は画面上に変化が残らないため、呼び出し側は onError で
 * 必ずユーザーへ通知する（失敗が見えないと「押したのに効かない」
 * 状態になる）。
 */
export function useToggleFavorite(
  favoriteIds: Set<number>,
  options?: { onError?: (error: unknown) => void },
) {
  const add = useAddFavorite();
  const remove = useRemoveFavorite();

  return {
    toggle: (annictWorkId: number) => {
      const action = nextFavoriteAction(favoriteIds, annictWorkId);
      // お気に入りの追加/解除の操作を計測する（issue #214）。成否ではなく
      // ユーザーの操作意図を記録するため mutate 前に送る。
      trackEvent("favorite_toggle", { [TRACK_EVENT_KEYS.action]: action });
      const mutation = action === "remove" ? remove : add;
      // 呼び出し別コールバック（mutate の第2引数）は連続 mutate で
      // 前の呼び出し分が発火しないため、mutateAsync の promise で
      // 失敗を個別に拾う。
      void mutation
        .mutateAsync(annictWorkId)
        .catch((e: unknown) => options?.onError?.(e));
    },
    isPending: add.isPending || remove.isPending,
  };
}
