import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { FRIENDS_QUERY_KEY } from "@/lib/useFriends";

type BlocksResponse = InferResponseType<
  (typeof apiClient.me.blocks)["$get"],
  200
>;
export type BlockedUserItem = BlocksResponse[number];

export const BLOCKS_QUERY_KEY = ["blocks"] as const;

const blocksQueryKey = (userId: string) =>
  [...BLOCKS_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

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
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (input: { userId: string; reason: string }) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.users[":id"].report.$post(
        { param: { id: input.userId }, json: { reason: input.reason } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "通報に失敗しました");
      }
      return res.json();
    },
  });
}

export function useBlockUser() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.users[":id"].block.$post(
        { param: { id: targetUserId } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "ブロックに失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, targetUserId) => {
      // フレンド一覧から消え、ブロック一覧に現れ、名刺は見えなくなる。
      queryClient.invalidateQueries({
        queryKey: userId ? blocksQueryKey(userId) : BLOCKS_QUERY_KEY,
      });
      queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: ["public-profile", targetUserId],
      });
    },
  });
}

export function useUnblockUser() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.users[":id"].block.$delete(
        { param: { id: targetUserId } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "ブロック解除に失敗しました");
      }
      return res.json();
    },
    onSuccess: (_data, targetUserId) => {
      queryClient.invalidateQueries({
        queryKey: userId ? blocksQueryKey(userId) : BLOCKS_QUERY_KEY,
      });
      queryClient.invalidateQueries({ queryKey: FRIENDS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: ["public-profile", targetUserId],
      });
    },
  });
}

export function useBlockedUsers() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? blocksQueryKey(userId) : BLOCKS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.blocks.$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "ブロック一覧の取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}
