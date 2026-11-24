import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { tierListQueries } from "@/lib/queries/tierLists";
import type {
  PublicTierListsResponse,
  PublicTierListsSort,
  TierListLikeResponse,
} from "@/lib/queries/tierLists";
import type { TierListKind } from "./useMergedTierLists";

// 公開 tier 表（ひろば「みつける」タブ, issue #418）。sort ごとに
// キャッシュを分ける。先頭 2 要素が共通プレフィックスなので、
// これで一覧・詳細の両方を invalidate できる（useModeration の
// ブロック操作からも使う。workList/useWorkLists と同じ構造）。
export const PUBLIC_TIER_LISTS_KEY = tierListQueries.public.all;
const publicTierListsQueryKey = tierListQueries.public.key;
const publicTierListQueryKey = tierListQueries.public.detail.key;

export type {
  PublicTierListItem,
  PublicTierListsResponse,
  PublicTierListsSort,
} from "@/lib/queries/tierLists";

/**
 * 公開 tier 表の一覧（3 種類の結合フィード）。
 * カーソルページングの API のため useInfiniteQuery で取り、
 * nextCursor がある限り続きを読める（usePublicWorkLists と同じ構造）。
 */
export function usePublicTierLists(sort: PublicTierListsSort) {
  const { isSignedIn } = useAuth();

  return useInfiniteQuery({
    ...tierListQueries.public.list.query({ sort }),
    enabled: !!isSignedIn,
  });
}

/**
 * 公開 tier 表 1 件の詳細（配置済みアイテムつき）。
 * みつけるカードの遷移先画面が読む。一覧と同じ可視条件なので、
 * 見えないリストは 404（data undefined・isError）になる。
 */
export function usePublicTierList(kind: TierListKind, id: number | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...tierListQueries.public.detail.query({ kind, id: id ?? 0 }),
    enabled: !!isSignedIn && id !== null,
  });
}

/**
 * 公開 tier 表へのいいねの切り替え。
 * PUT/DELETE とも冪等な API で、応答の likeCount・likedByMe を
 * 両ソートのキャッシュと詳細キャッシュにそのまま反映する。
 */
export function useToggleTierListLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      kind: TierListKind;
      id: number;
      like: boolean;
    }) => {
      // 流量制限ミドルウェアの 429 は {error} に理由が入るため、
      // 標準の ApiRequestError 化ではなく応答の文言を拾う。
      const fetch = apiFetch({
        onHttpError: async (errorRes) => {
          if (errorRes.status === 429) {
            const body = (await errorRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            return new ApiRequestError(
              errorRes.status,
              body?.error ?? "いいねの更新に失敗しました",
            );
          }
          return new ApiRequestError(
            errorRes.status,
            "いいねの更新に失敗しました",
          );
        },
      });
      const param = { kind: input.kind, id: String(input.id) };
      const res = input.like
        ? await apiClient["tier-lists"][":kind"][":id"].like.$put(
            { param },
            { fetch },
          )
        : await apiClient["tier-lists"][":kind"][":id"].like.$delete(
            { param },
            { fetch },
          );
      return res.json() as Promise<TierListLikeResponse>;
    },
    onSuccess: (data, input) => {
      for (const sort of ["likes", "new"] as const) {
        queryClient.setQueryData(
          publicTierListsQueryKey(sort),
          (prev: { pages: PublicTierListsResponse[] } | undefined) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((page) => ({
                    ...page,
                    items: page.items.map((item) =>
                      item.kind === input.kind && item.id === input.id
                        ? {
                            ...item,
                            likeCount: data.likeCount,
                            likedByMe: data.likedByMe,
                          }
                        : item,
                    ),
                  })),
                }
              : prev,
        );
      }
      // 詳細画面のキャッシュも同じ応答で更新する。
      queryClient.setQueryData(
        publicTierListQueryKey(input.kind, input.id),
        (prev: { likeCount: number; likedByMe: boolean } | undefined) =>
          prev
            ? {
                ...prev,
                likeCount: data.likeCount,
                likedByMe: data.likedByMe,
              }
            : prev,
      );
    },
  });
}

/**
 * 公開 tier 表の通報。理由はユーザー通報と同じプリセットをそのまま送る。
 * 429 はサーバーの理由を見せる（useReportWorkList と同じ扱い）。
 */
export function useReportTierList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      kind: TierListKind;
      id: number;
      reason: string;
    }) => {
      const res = await apiClient["tier-lists"][":kind"][":id"].report.$post(
        {
          param: { kind: input.kind, id: String(input.id) },
          json: { reason: input.reason },
        },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              if (errorRes.status === 429) {
                const body = (await errorRes.json().catch(() => null)) as {
                  error?: string;
                } | null;
                return new ApiRequestError(
                  errorRes.status,
                  body?.error ?? "通報の送信回数が上限に達しました",
                );
              }
              return new ApiRequestError(errorRes.status, "通報に失敗しました");
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      // 通報の直後に所有者ブロックへ進む流れのため、ブロック成立前から
      // 一覧を古いまま残さないよう再取得に倒す。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}
