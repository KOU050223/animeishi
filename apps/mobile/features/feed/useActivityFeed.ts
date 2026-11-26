import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import {
  activityFeedQueries,
  type ActivityFeedItem,
} from "@/lib/queries/activity";

export type { ActivityFeedItem };

export const ACTIVITY_FEED_QUERY_KEY = activityFeedQueries.all;

// フレンドの活動フィード（issue #265）。API がカーソルページングのため
// useInfiniteQuery で取り、nextCursor がある限り続きを読める。
export function useActivityFeed() {
  const { isSignedIn, userId } = useAuth();

  return useInfiniteQuery({
    ...activityFeedQueries.list.query({ userId }),
    enabled: !!isSignedIn && !!userId,
  });
}
