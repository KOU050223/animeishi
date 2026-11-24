import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { PUBLIC_PROFILE_QUERY_KEY } from "@/lib/publicProfile";
import { FRIENDS_QUERY_KEY, FRIEND_REQUESTS_QUERY_KEY } from "@/lib/useFriends";
import { COMMON_POINTS_QUERY_KEY } from "@/lib/useCommonPoints";
import { EVENT_PARTICIPANTS_QUERY_KEY } from "@/lib/useEvents";
import { PUBLIC_WORK_LISTS_KEY } from "@/lib/workList/useWorkLists";
import { PUBLIC_TIER_LISTS_KEY } from "@/lib/tierList/usePublicTierLists";
import { PUBLIC_USERS_KEY } from "@/lib/usePublicUsers";
import { FRIEND_THANKS_QUERY_KEY } from "@/lib/useFriendThanks";

import { blockQueries } from "@/lib/queries/moderation";

export type { BlockedUserItem } from "@/lib/queries/moderation";

export const BLOCKS_QUERY_KEY = blockQueries.all;

export function getReportErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 429) {
    if (error.code === "duplicate_target")
      return "同じユーザーへの通報は24時間に1回までです";
    if (error.code === "hourly_limit")
      return "通報の送信回数が上限に達しました。しばらくしてから再度お試しください";
    // edge のユーザー単位流量制限（issue #715）
    if (error.code === "rate_limited")
      return "リクエストが多すぎます。しばらくしてからお試しください";
  }
  return "通報に失敗しました";
}

const blocksQueryKey = blockQueries.key;

/** 通報理由のプリセット。理由は API にそのまま文字列として送る。 */
export const REPORT_REASONS = [
  "不適切なコンテンツ",
  "スパム・宣伝",
  "ハラスメント・嫌がらせ",
  "なりすまし",
  "その他",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export function useReportUser() {
  return useMutation({
    mutationFn: async (input: { userId: string; reason: string }) => {
      const res = await apiClient.users[":id"].report.$post(
        { param: { id: input.userId }, json: { reason: input.reason } },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              // 429（レート制限・重複通報）はサーバーの理由メッセージを
              // そのまま見せる（同一対象の再通報と回数上限で文言が違うため）。
              if (errorRes.status === 429) {
                const body = (await errorRes.json().catch(() => null)) as {
                  error?: string;
                  code?: string;
                } | null;
                return new ApiRequestError(
                  errorRes.status,
                  body?.error ?? "通報の送信回数が上限に達しました",
                  body?.code,
                );
              }
              return new ApiRequestError(errorRes.status, "通報に失敗しました");
            },
          }),
        },
      );
      return res.json();
    },
  });
}

export function useBlockUser() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const res = await apiClient.users[":id"].block.$post(
        { param: { id: targetUserId } },
        {
          fetch: apiFetch({
            errorMessage: "ブロックに失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, targetUserId) => {
      queryClient.removeQueries({ queryKey: COMMON_POINTS_QUERY_KEY });
      // フレンド一覧・フレンド申請から消え、ブロック一覧に現れ、名刺は
      // 見えなくなる（ブロックで申請行もサーバー側で消える。issue #417）。
      void queryClient.invalidateQueries({
        queryKey: userId ? blocksQueryKey(userId) : BLOCKS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: FRIEND_REQUESTS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: [...PUBLIC_PROFILE_QUERY_KEY, targetUserId],
      });
      // ブロックで相手の公開作品リストも見えなくなる（issue #422）。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_WORK_LISTS_KEY });
      // 公開 tier 表・公開名刺も同じ可視条件（issue #418）。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: PUBLIC_USERS_KEY });
      // イベントの参加者一覧・「参加しているフレンド」欄からも除く
      // （issue #440）。
      void queryClient.invalidateQueries({
        queryKey: EVENT_PARTICIPANTS_QUERY_KEY,
      });
      // お礼もブロックで消える（issue #694）。
      void queryClient.invalidateQueries({
        queryKey: FRIEND_THANKS_QUERY_KEY,
      });
    },
  });
}

export function useUnblockUser() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const res = await apiClient.users[":id"].block.$delete(
        { param: { id: targetUserId } },
        {
          fetch: apiFetch({
            errorMessage: "ブロック解除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: (_data, targetUserId) => {
      void queryClient.invalidateQueries({
        queryKey: userId ? blocksQueryKey(userId) : BLOCKS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: [...PUBLIC_PROFILE_QUERY_KEY, targetUserId],
      });
      // ブロック解除で相手の公開作品リストが見えるようになる。
      void queryClient.invalidateQueries({ queryKey: PUBLIC_WORK_LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: PUBLIC_TIER_LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: PUBLIC_USERS_KEY });
      void queryClient.invalidateQueries({
        queryKey: EVENT_PARTICIPANTS_QUERY_KEY,
      });
    },
  });
}

export function useBlockedUsers() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...blockQueries.list.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}
