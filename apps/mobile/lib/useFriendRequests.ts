import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import {
  FRIEND_REQUESTS_QUERY_KEY,
  invalidateFriendRelatedQueries,
} from "./useFriends";

type FriendRequestsResponse = InferResponseType<
  (typeof apiClient.me)["friend-requests"]["$get"],
  200
>;
export type FriendRequestItem = FriendRequestsResponse["received"][number];

const friendRequestsQueryKey = (userId: string) =>
  [...FRIEND_REQUESTS_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

// 届いた申請をバッジで知らせるためのポーリング間隔（プッシュ通知 #410 が
// できるまでの代用）。
const FRIEND_REQUESTS_REFETCH_INTERVAL = 60_000;

/**
 * フレンド申請の一覧（届いた received / 送った sent）。
 * アプリ内バッジで届いた申請に気づけるよう、マウント中は定期的に再取得する。
 */
export function useFriendRequests() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId
      ? friendRequestsQueryKey(userId)
      : FRIEND_REQUESTS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    refetchInterval: FRIEND_REQUESTS_REFETCH_INTERVAL,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["friend-requests"].$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "フレンド申請一覧の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/** 届いた申請（承認待ち）の件数。タブバー・セグメントのバッジ表示に使う。 */
export function useReceivedFriendRequestCount(): number {
  const { data } = useFriendRequests();
  return data?.received.length ?? 0;
}

/** フレンド申請を送る。応答の status が "accepted" なら相互申請で即成立。 */
export function useSendFriendRequest() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (addresseeId: string) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["friend-requests"].$post(
        { json: { userId: addresseeId } },
        { headers },
      );
      if (!res.ok) {
        if (res.status === 404) {
          throw new ApiRequestError(404, "ユーザーが見つかりません");
        }
        if (res.status === 403) {
          throw new ApiRequestError(403, "このユーザーには申請できません");
        }
        if (res.status === 409) {
          throw new ApiRequestError(409, "すでにフレンドです");
        }
        throw new ApiRequestError(res.status, "フレンド申請に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

/** 届いた申請を承認する。requestId は申請行の ID（相手のユーザーIDではない）。 */
export function useAcceptFriendRequest() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["friend-requests"][":id"].accept.$post(
        { param: { id: String(requestId) } },
        { headers },
      );
      if (!res.ok) {
        if (res.status === 404) {
          throw new ApiRequestError(404, "申請が見つかりませんでした");
        }
        if (res.status === 403) {
          throw new ApiRequestError(403, "このユーザーは承認できません");
        }
        throw new ApiRequestError(res.status, "申請の承認に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

/** 申請を削除する。届いた申請の拒否と送った申請の取消の両方に使う。 */
export function useDeleteFriendRequest() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: number) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["friend-requests"][":id"].$delete(
        { param: { id: String(requestId) } },
        { headers },
      );
      if (!res.ok) {
        if (res.status === 404) {
          throw new ApiRequestError(404, "申請が見つかりませんでした");
        }
        throw new ApiRequestError(res.status, "申請の削除に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}
