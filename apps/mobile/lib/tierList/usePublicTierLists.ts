import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import type { TierListKind } from "./useMergedTierLists";

// 公開 tier 表（ひろば「みつける」タブ, issue #418）。sort ごとに
// キャッシュを分ける。先頭 2 要素が共通プレフィックスなので、
// これで一覧・詳細の両方を invalidate できる（useModeration の
// ブロック操作からも使う。workList/useWorkLists と同じ構造）。
export const PUBLIC_TIER_LISTS_KEY = ["tier-list", "public"] as const;
const publicTierListsQueryKey = (sort: PublicTierListsSort) =>
  [...PUBLIC_TIER_LISTS_KEY, sort] as const;
const publicTierListQueryKey = (kind: TierListKind, id: number) =>
  [...PUBLIC_TIER_LISTS_KEY, "detail", kind, id] as const;

export type PublicTierListsSort = "likes" | "new";

type PublicTierListsResponse = InferResponseType<
  (typeof apiClient)["tier-lists"]["public"]["$get"],
  200
>;
export type PublicTierListItem = PublicTierListsResponse["items"][number];

const PUBLIC_LIST_PAGE_LIMIT = "20";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 公開 tier 表の一覧（3 種類の結合フィード）。
 * カーソルページングの API のため useInfiniteQuery で取り、
 * nextCursor がある限り続きを読める（usePublicWorkLists と同じ構造）。
 */
export function usePublicTierLists(sort: PublicTierListsSort) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: publicTierListsQueryKey(sort),
    enabled: !!isSignedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient["tier-lists"].public.$get(
        {
          query: {
            sort,
            limit: PUBLIC_LIST_PAGE_LIMIT,
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "公開 tier 表の取得に失敗しました",
        );
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * 公開 tier 表 1 件の詳細（配置済みアイテムつき）。
 * みつけるカードの遷移先画面が読む。一覧と同じ可視条件なので、
 * 見えないリストは 404（data undefined・isError）になる。
 */
export function usePublicTierList(kind: TierListKind, id: number | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: publicTierListQueryKey(kind, id ?? 0),
    enabled: !!isSignedIn && id !== null,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient["tier-lists"][":kind"][":id"].$get(
        { param: { kind, id: String(id) } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "公開 tier 表の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * 公開 tier 表へのいいねの切り替え。
 * PUT/DELETE とも冪等な API で、応答の likeCount・likedByMe を
 * 両ソートのキャッシュと詳細キャッシュにそのまま反映する。
 */
export function useToggleTierListLike() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      kind: TierListKind;
      id: number;
      like: boolean;
    }) => {
      const headers = await getAuthHeaders(getToken);
      const param = { kind: input.kind, id: String(input.id) };
      const res = input.like
        ? await apiClient["tier-lists"][":kind"][":id"].like.$put(
            { param },
            { headers },
          )
        : await apiClient["tier-lists"][":kind"][":id"].like.$delete(
            { param },
            { headers },
          );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "いいねの更新に失敗しました");
      }
      return res.json();
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
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      kind: TierListKind;
      id: number;
      reason: string;
    }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient["tier-lists"][":kind"][":id"].report.$post(
        {
          param: { kind: input.kind, id: String(input.id) },
          json: { reason: input.reason },
        },
        { headers },
      );
      if (!res.ok) {
        if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new ApiRequestError(
            res.status,
            body?.error ?? "通報の送信回数が上限に達しました",
          );
        }
        throw new ApiRequestError(res.status, "通報に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      // 通報の直後に所有者ブロックへ進む流れのため、ブロック成立前から
      // 一覧を古いまま残さないよう再取得に倒す。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
    },
  });
}
