import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type StoriesResponse = InferResponseType<
  (typeof apiClient.me.feed.stories)["$get"],
  200
>;
export type FriendWatchStory = StoriesResponse["friends"][number];
export type FriendWatchStoryItem = FriendWatchStory["items"][number];

export const FRIEND_WATCH_STORIES_QUERY_KEY = ["friend-watch-stories"] as const;

// 直近 24 時間に視聴記録をつけたフレンドとその活動（issue #266）。
// ホーム上部のストーリーリングと全画面ビューアが同じデータを使う。
export function useFriendWatchStories() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: [...FRIEND_WATCH_STORIES_QUERY_KEY, userId],
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const res = await apiClient.me.feed.stories.$get(
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "ストーリーの取得に失敗しました");
      }
      return res.json();
    },
  });
}
