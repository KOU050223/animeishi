import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import {
  ApiRequestError,
  readApiErrorCode,
  readRetryAfterSeconds,
} from "@/lib/apiError";
import { apiErrorMessage } from "@/lib/apiErrorMessages";
import { invalidateFriendRelatedQueries } from "@/features/friends/useFriends";
import { friendQueries } from "@/lib/queries/friends";
import type { FriendRequestSendResponse } from "@/lib/queries/friends";

export type { FriendRequestItem } from "@/lib/queries/friends";

// 届いた申請をバッジで知らせるためのポーリング間隔（プッシュ通知 #410 が
// できるまでの代用）。
const FRIEND_REQUESTS_REFETCH_INTERVAL = 60_000;

/**
 * フレンド申請の一覧（届いた received / 送った sent）。
 * アプリ内バッジで届いた申請に気づけるよう、マウント中は定期的に再取得する。
 */
export function useFriendRequests() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...friendQueries.requests.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
    refetchInterval: FRIEND_REQUESTS_REFETCH_INTERVAL,
  });
}

/** 届いた申請（承認待ち）の件数。タブバー・セグメントのバッジ表示に使う。 */
export function useReceivedFriendRequestCount(): number {
  const { data } = useFriendRequests();
  return data?.received.length ?? 0;
}

/** フレンド申請を送る。応答の status が "accepted" なら相互申請で即成立。 */
export function useSendFriendRequest() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (addresseeId: string) => {
      const res = await apiClient.me["friend-requests"].$post(
        { json: { userId: addresseeId } },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              if (errorRes.status === 404) {
                return new ApiRequestError(404, "ユーザーが見つかりません");
              }
              if (errorRes.status === 403) {
                return new ApiRequestError(
                  403,
                  "このユーザーには申請できません",
                );
              }
              if (errorRes.status === 409) {
                return new ApiRequestError(409, "すでにフレンドです");
              }
              // 429（送信数の上限）は code から表示文言を引く（issue #838）
              if (errorRes.status === 429) {
                const code = await readApiErrorCode(errorRes);
                return new ApiRequestError(
                  errorRes.status,
                  apiErrorMessage(code) ?? "フレンド申請に失敗しました",
                  code,
                  readRetryAfterSeconds(errorRes),
                );
              }
              return new ApiRequestError(
                errorRes.status,
                "フレンド申請に失敗しました",
              );
            },
          }),
        },
      );
      return res.json() as Promise<FriendRequestSendResponse>;
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

/** 届いた申請を承認する。requestId は申請行の ID（相手のユーザーIDではない）。 */
export function useAcceptFriendRequest() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: number) => {
      const res = await apiClient.me["friend-requests"][":id"].accept.$post(
        { param: { id: String(requestId) } },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              if (errorRes.status === 404) {
                return new ApiRequestError(404, "申請が見つかりませんでした");
              }
              if (errorRes.status === 403) {
                return new ApiRequestError(403, "このユーザーは承認できません");
              }
              return new ApiRequestError(
                errorRes.status,
                "申請の承認に失敗しました",
              );
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}

/** 申請を削除する。届いた申請の拒否と送った申請の取消の両方に使う。 */
export function useDeleteFriendRequest() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: number) => {
      const res = await apiClient.me["friend-requests"][":id"].$delete(
        { param: { id: String(requestId) } },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              if (errorRes.status === 404) {
                return new ApiRequestError(404, "申請が見つかりませんでした");
              }
              return new ApiRequestError(
                errorRes.status,
                "申請の削除に失敗しました",
              );
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      invalidateFriendRelatedQueries(queryClient, userId);
    },
  });
}
