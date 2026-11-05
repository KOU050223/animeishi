import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// 公開名刺の一覧（ひろば「みつける」タブ, issue #418）。公開条件は
// 既存のプロフィール公開設定（users.is_public）を使う。sort ごとに
// キャッシュを分け、先頭 2 要素の共通プレフィックスでブロック操作
// からまとめて invalidate できるようにする（PUBLIC_WORK_LISTS_KEY と同じ）。
export const PUBLIC_USERS_KEY = ["users", "public"] as const;
const publicUsersQueryKey = (sort: PublicUsersSort) =>
  [...PUBLIC_USERS_KEY, sort] as const;

export type PublicUsersSort = "likes" | "new";

type PublicUsersResponse = InferResponseType<
  (typeof apiClient)["users"]["public"]["$get"],
  200
>;
export type PublicUserItem = PublicUsersResponse["items"][number];

const PUBLIC_LIST_PAGE_LIMIT = "20";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 公開名刺の一覧。カーソルページングの API のため useInfiniteQuery で取り、
 * nextCursor がある限り続きを読める（usePublicWorkLists と同じ構造）。
 */
export function usePublicUsers(sort: PublicUsersSort) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: publicUsersQueryKey(sort),
    enabled: !!isSignedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.users.public.$get(
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
        throw new ApiRequestError(res.status, "公開名刺の取得に失敗しました");
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * 名刺へのいいねの切り替え。PUT/DELETE とも冪等な API で、
 * 応答の likeCount・likedByMe を両ソートのキャッシュに反映する。
 */
export function useToggleUserLike() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; like: boolean }) => {
      const headers = await getAuthHeaders(getToken);
      const param = { id: input.id };
      const res = input.like
        ? await apiClient.users[":id"].like.$put({ param }, { headers })
        : await apiClient.users[":id"].like.$delete({ param }, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "いいねの更新に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data, input) => {
      for (const sort of ["likes", "new"] as const) {
        queryClient.setQueryData(
          publicUsersQueryKey(sort),
          (prev: { pages: PublicUsersResponse[] } | undefined) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((page) => ({
                    ...page,
                    items: page.items.map((item) =>
                      item.id === input.id
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
    },
  });
}
