import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type UpdatesResponse = InferResponseType<
  (typeof apiClient.me.friends)[":friendId"]["updates"]["$get"],
  200
>;
export type FriendUpdateItem = UpdatesResponse["items"][number];

// 名刺帳の相手の近況（issue #660）。API は /me/friends/{friendId}/updates で、
// フレンドでなければ 404、相手が非公開なら空の items を返す。
const friendUpdatesQueryKey = (userId: string, friendId: string) =>
  ["friend-updates", userId, friendId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 相手の近況を取得する。enabled でフレンド判定が確定してから取得させる
 * （フレンドでなければ API は 404 を返す）。
 */
export function useFriendUpdates(
  friendId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey:
      userId && friendId
        ? friendUpdatesQueryKey(userId, friendId)
        : (["friend-updates"] as const),
    enabled: enabled && !!isSignedIn && !!userId && !!friendId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends[":friendId"].updates.$get(
        { param: { friendId: friendId! } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "近況の取得に失敗しました");
      }
      return res.json();
    },
  });
}
