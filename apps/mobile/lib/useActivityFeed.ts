import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type FeedResponse = InferResponseType<(typeof apiClient.me.feed)["$get"], 200>;
export type ActivityFeedItem = FeedResponse["items"][number];

export const ACTIVITY_FEED_QUERY_KEY = ["activity-feed"] as const;

const FEED_PAGE_LIMIT = "20";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

// フレンドの活動フィード（issue #265）。API がカーソルページングのため
// useInfiniteQuery で取り、nextCursor がある限り続きを読める。
export function useActivityFeed() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useInfiniteQuery({
    queryKey: [...ACTIVITY_FEED_QUERY_KEY, userId],
    enabled: !!isSignedIn && !!userId,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.feed.$get(
        {
          query: {
            limit: FEED_PAGE_LIMIT,
            ...(pageParam !== undefined ? { cursor: String(pageParam) } : {}),
          },
        },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "活動フィードの取得に失敗しました",
        );
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
