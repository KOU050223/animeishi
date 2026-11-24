import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch, clerkSessionToken } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type CommonPointsResponse = InferResponseType<
  (typeof apiClient.users)[":id"]["common"]["$get"],
  200
>;

// 相手との共通点（GET /users/:id/common）のクエリファクトリ
// （issue #726）。キー値は移行前と同一。
export const commonPointsQueries = {
  all: ["common-points"] as const,
  key: (userId: string | null | undefined, uid: string) =>
    [...commonPointsQueries.all, userId, uid] as const,
  detail: {
    query: (args: { userId: string | null | undefined; uid: string }) =>
      queryOptions({
        queryKey: commonPointsQueries.key(args.userId, args.uid),
        queryFn: async () => {
          // トークン欠如は plain Error ではなく ApiRequestError(401) に
          // する移行前の契約を維持する（apiFetch とは別経路なので事前に確認）。
          if (!(await clerkSessionToken())) {
            throw new ApiRequestError(401, "認証が必要です");
          }
          const res = await apiClient.users[":id"].common.$get(
            { param: { id: args.uid } },
            {
              fetch: apiFetch({
                errorMessage: "共通点を取得できませんでした",
              }),
            },
          );
          return res.json() as Promise<CommonPointsResponse>;
        },
      }),
  },
} as const;
