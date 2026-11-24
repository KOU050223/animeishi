import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

type StoriesResponse = InferResponseType<
  (typeof apiClient.me.feed.stories)["$get"],
  200
>;
export type FriendWatchStory = StoriesResponse["friends"][number];

// フレンド視聴ストーリー（/me/feed/stories）のクエリファクトリ
// （issue #726）。直近 24 時間に視聴記録をつけたフレンドとその活動
// （issue #266）。キー値は移行前と同一。
export const friendWatchStoriesQueries = {
  all: ["friend-watch-stories"] as const,
  key: (userId: string | null | undefined) =>
    [...friendWatchStoriesQueries.all, userId] as const,
  list: {
    query: (args: { userId: string | null | undefined }) =>
      queryOptions({
        queryKey: friendWatchStoriesQueries.key(args.userId),
        queryFn: async () => {
          const res = await apiClient.me.feed.stories.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "ストーリーの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<StoriesResponse>;
        },
      }),
  },
} as const;
