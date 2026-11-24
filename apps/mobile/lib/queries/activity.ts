import { infiniteQueryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type FeedResponse = InferResponseType<
  (typeof apiClient.me.feed)["$get"],
  200
>;
export type ActivityFeedItem = FeedResponse["items"][number];

const FEED_PAGE_LIMIT = "20";

// 活動フィードドメイン（GET /me/feed）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。
export const activityFeedQueries = {
  all: ["activity-feed"] as const,
  /**
   * フレンドの活動フィード（カーソルページング）。
   * 移行前は userId 未確定でもキー末尾に要素を載せていたため、
   * 値を変えないようそのままにする。
   */
  list: {
    query: (args: { userId: string | null | undefined }) =>
      infiniteQueryOptions({
        queryKey: [...activityFeedQueries.all, args.userId],
        initialPageParam: undefined as number | undefined,
        queryFn: async ({ pageParam }) => {
          const res = await apiClient.me.feed.$get(
            {
              query: {
                limit: FEED_PAGE_LIMIT,
                ...(pageParam !== undefined
                  ? { cursor: String(pageParam) }
                  : {}),
              },
            },
            {
              fetch: apiFetch({
                errorMessage: "活動フィードの取得に失敗しました",
              }),
            },
          );
          // apiFetch が !ok を排除済みなので、res.json() の union から
          // 成功型に絞る。
          return res.json() as Promise<FeedResponse>;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }),
  },
} as const;
