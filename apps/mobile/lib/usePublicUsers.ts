import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import {
  ApiRequestError,
  readApiErrorCode,
  readRetryAfterSeconds,
} from "@/lib/apiError";
import { apiErrorMessage } from "@/lib/apiErrorMessages";
import {
  publicUserQueries,
  type PublicUsersResponse,
  type PublicUsersSort,
} from "@/lib/queries/users";

// 公開名刺の一覧（ひろば「みつける」タブ, issue #418）。公開条件は
// 既存のプロフィール公開設定（users.is_public）を使う。sort ごとに
// キャッシュを分け、先頭 2 要素の共通プレフィックスでブロック操作
// からまとめて invalidate できるようにする（PUBLIC_WORK_LISTS_KEY と同じ）。
export const PUBLIC_USERS_KEY = publicUserQueries.all;
const publicUsersQueryKey = (sort: PublicUsersSort) =>
  publicUserQueries.key(sort);

export type { PublicUsersSort, PublicUserItem } from "@/lib/queries/users";

/**
 * 公開名刺の一覧。カーソルページングの API のため useInfiniteQuery で取り、
 * nextCursor がある限り続きを読める（usePublicWorkLists と同じ構造）。
 */
export function usePublicUsers(sort: PublicUsersSort) {
  const { isSignedIn } = useAuth();

  return useInfiniteQuery({
    ...publicUserQueries.list.query({ sort }),
    enabled: !!isSignedIn,
  });
}

/**
 * 名刺へのいいねの切り替え。PUT/DELETE とも冪等な API で、
 * 応答の likeCount・likedByMe を両ソートのキャッシュに反映する。
 */
export function useToggleUserLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; like: boolean }) => {
      const param = { id: input.id };
      // 流量制限ミドルウェアの 429 応答は OpenAPI 経由ではないので
      // ルートの型に含まれない。表示文言は code から引くため標準の
      // ApiRequestError 化ではなく応答を見て組み立てる（issue #838）。
      const fetcher = apiFetch({
        onHttpError: async (res) => {
          const status = res.status;
          if (status === 429) {
            const code = await readApiErrorCode(res);
            return new ApiRequestError(
              status,
              apiErrorMessage(code) ?? "いいねの更新に失敗しました",
              code,
              readRetryAfterSeconds(res),
            );
          }
          return new ApiRequestError(status, "いいねの更新に失敗しました");
        },
      });
      const res = input.like
        ? await apiClient.users[":id"].like.$put({ param }, { fetch: fetcher })
        : await apiClient.users[":id"].like.$delete(
            { param },
            { fetch: fetcher },
          );
      // apiFetch が !ok を排除済みなので、res.json() の union から
      // 成功型に絞る（PUT/DELETE の応答形は likeCount・likedByMe で共通）。
      return res.json() as Promise<{
        likeCount: number;
        likedByMe: boolean;
      }>;
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
