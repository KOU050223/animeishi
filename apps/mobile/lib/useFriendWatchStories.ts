import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { friendWatchStoriesQueries } from "@/lib/queries/friendStories";

export type { FriendWatchStory } from "@/lib/queries/friendStories";

export const FRIEND_WATCH_STORIES_QUERY_KEY = friendWatchStoriesQueries.all;

// 直近 24 時間に視聴記録をつけたフレンドとその活動（issue #266）。
// ホーム上部のストーリーリングと全画面ビューアが同じデータを使う。
export function useFriendWatchStories() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendWatchStoriesQueries.list.query({ userId }),
    enabled: !!isSignedIn && !!userId,
  });
}
