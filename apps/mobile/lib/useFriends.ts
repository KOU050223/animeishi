import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type FriendsResponse = InferResponseType<
  (typeof apiClient.me.friends)["$get"],
  200
>;
export type FriendItem = FriendsResponse[number];

export const FRIENDS_QUERY_KEY = ["friends"] as const;

const friendsQueryKey = (userId: string) =>
  [...FRIENDS_QUERY_KEY, userId] as const;

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

export function useAddFriend() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendId: string) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.friends.$post(
        { json: { friendId } },
        { headers },
      );
      const status = res.status;
      if (!res.ok) {
        if (status === 404) {
          throw new ApiRequestError(404, "ユーザーが見つかりません");
        }
        if (status === 400) {
          throw new ApiRequestError(400, "このユーザーは追加できません");
        }
        throw new ApiRequestError(status, "フレンド追加に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? friendsQueryKey(userId) : FRIENDS_QUERY_KEY,
      });
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
      queryClient.invalidateQueries({
        queryKey: userId ? friendsQueryKey(userId) : FRIENDS_QUERY_KEY,
      });
    },
  });
}
