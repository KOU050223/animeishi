import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { ACTIVITY_FEED_QUERY_KEY } from "./useActivityFeed";
import { FRIEND_WATCH_STORIES_QUERY_KEY } from "./useFriendWatchStories";

type FriendsResponse = InferResponseType<
  (typeof apiClient.me.friends)["$get"],
  200
>;
export type FriendItem = FriendsResponse[number];

export const FRIENDS_QUERY_KEY = ["friends"] as const;
export const FRIEND_REQUESTS_QUERY_KEY = ["friend-requests"] as const;

const friendsQueryKey = (userId: string) =>
  [...FRIENDS_QUERY_KEY, userId] as const;
const friendRequestsQueryKey = (userId: string) =>
  [...FRIEND_REQUESTS_QUERY_KEY, userId] as const;

// フレンド関係が変わると一覧・申請一覧・活動フィード・ストーリーの内容が
// 変わるため、すべて無効化する（各キャッシュは userId サフィックス付きなので
// prefix で無効化する）。QR の即時成立でも申請行が消えうるため申請一覧を含む
// （issue #417）。
export function invalidateFriendRelatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null | undefined,
) {
  void queryClient.invalidateQueries({
    queryKey: userId ? friendsQueryKey(userId) : FRIENDS_QUERY_KEY,
  });
  void queryClient.invalidateQueries({
    queryKey: userId
      ? friendRequestsQueryKey(userId)
      : FRIEND_REQUESTS_QUERY_KEY,
  });
  void queryClient.invalidateQueries({ queryKey: ACTIVITY_FEED_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: FRIEND_WATCH_STORIES_QUERY_KEY,
  });
}

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

export function useFriends() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? friendsQueryKey(userId) : FRIENDS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends.$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "フレンド一覧の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * 登録済みフレンドの ID Set を返す。「すでにフレンドか」を高速判定するためのヘルパー。
 */
export function useFriendIds(): Set<string> {
  const { data } = useFriends();
  return useMemo(() => new Set((data ?? []).map((f) => f.friendId)), [data]);
}

// POST /me/friends は対面 QR の即時成立専用。トークン TTL より早い周期で
// 再取得して、提示中の QR が期限切れにならないようにする。
const QR_TOKEN_REFETCH_INTERVAL_MS = 60_000;

/**
 * 対面 QR 交換用の短期トークンを取得する（issue #417）。
 * マイ QR の QR ペイロードに `?qt=` で埋め込み、読み取った側が
 * POST /me/friends にそのまま渡す。トークン無しの即時成立は API が
 * 403 で拒否するため、リモート追加は申請フローしか通らない。
 */
export function useQrExchangeToken() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: ["qr-exchange-token", userId] as const,
    enabled: !!isSignedIn && !!userId,
    // QR を提示し続ける間トークンを生かし続けるため定期再取得する。
    refetchInterval: QR_TOKEN_REFETCH_INTERVAL_MS,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends["qr-token"].$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "QR トークンの取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

export function useAddFriend() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { friendId: string; qrToken: string }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends.$post(
        { json: input },
        { headers },
      );
      const status = res.status;
      if (!res.ok) {
        const code = await readApiErrorCode(res);
        if (code === "qr_exchange_required") {
          throw new ApiRequestError(
            status,
            "QR の有効期限が切れています",
            code,
          );
        }
        if (status === 404) {
          throw new ApiRequestError(404, "ユーザーが見つかりません");
        }
        if (status === 400 || status === 403) {
          throw new ApiRequestError(status, "このユーザーは追加できません");
        }
        throw new ApiRequestError(status, "フレンド追加に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

export function useRemoveFriend() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendId: string) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends[":friendId"].$delete(
        { param: { friendId } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "フレンド削除に失敗しました");
      }
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}
