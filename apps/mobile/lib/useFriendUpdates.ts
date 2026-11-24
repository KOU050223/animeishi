import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { friendQueries } from "@/lib/queries/friends";

export type { FriendUpdateItem } from "@/lib/queries/friends";

// 名刺帳の相手の近況（issue #660）。API は /me/friends/{friendId}/updates で、
// フレンドでなければ 404、相手が非公開なら空の items を返す。

/**
 * 相手の近況を取得する。enabled でフレンド判定が確定してから取得させる
 * （フレンドでなければ API は 404 を返す）。
 */
export function useFriendUpdates(
  friendId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendQueries.updates.query({ userId: userId ?? null, friendId }),
    enabled: enabled && !!isSignedIn && !!userId && !!friendId,
  });
}
