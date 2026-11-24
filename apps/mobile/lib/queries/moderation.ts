import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type BlocksResponse = InferResponseType<
  (typeof apiClient.me.blocks)["$get"],
  200
>;
export type BlockedUserItem = BlocksResponse[number];

// ブロック（GET /me/blocks）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。
export const blockQueries = {
  all: ["blocks"] as const,
  key: (userId: string) => [...blockQueries.all, userId] as const,
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? blockQueries.key(args.userId)
          : blockQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.blocks.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "ブロック一覧の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<BlocksResponse>;
        },
      }),
  },
} as const;
