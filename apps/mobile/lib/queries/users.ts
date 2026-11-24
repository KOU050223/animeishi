import { infiniteQueryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type PublicUsersResponse = InferResponseType<
  (typeof apiClient)["users"]["public"]["$get"],
  200
>;
export type PublicUserItem = PublicUsersResponse["items"][number];
export type PublicUsersSort = "likes" | "new";

const PUBLIC_LIST_PAGE_LIMIT = "20";

// 公開名刺一覧ドメイン（GET /users/public）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。ソートごとにキャッシュを分け、all のプレフィックスで
// まとめて invalidate できる構造は既存のまま。
export const publicUserQueries = {
  all: ["users", "public"] as const,
  key: (sort: PublicUsersSort) => [...publicUserQueries.all, sort] as const,
  /**
   * 公開名刺の一覧（カーソルページング。認証必須だが公開データなので
   * userId はキーに含めない — 移行前のキー値を維持）。
   */
  list: {
    query: (args: { sort: PublicUsersSort }) =>
      infiniteQueryOptions({
        queryKey: publicUserQueries.key(args.sort),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
          const res = await apiClient.users.public.$get(
            {
              query: {
                sort: args.sort,
                limit: PUBLIC_LIST_PAGE_LIMIT,
                ...(pageParam !== undefined ? { cursor: pageParam } : {}),
              },
            },
            {
              fetch: apiFetch({
                errorMessage: "公開名刺の取得に失敗しました",
              }),
            },
          );
          return res.json();
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }),
  },
} as const;
