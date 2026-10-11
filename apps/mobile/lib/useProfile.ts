import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferRequestType, InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type ProfileResponse = InferResponseType<
  (typeof apiClient.me.profile)["$get"],
  200
>;
export type Profile = ProfileResponse;

export type ProfileUpdateInput = InferRequestType<
  (typeof apiClient.me.profile)["$put"]
>["json"];

export const PROFILE_QUERY_KEY = ["profile"] as const;

const profileQueryKey = (userId: string) =>
  [...PROFILE_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

export function useProfile() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? profileQueryKey(userId) : PROFILE_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.profile.$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "プロフィールの取得に失敗しました",
        );
      }
      return res.json();
    },
  });
}

/**
 * アカウント削除（DELETE /me）。
 * サーバー側で D1 のユーザーデータ・R2 アバター・Clerk ユーザー本体が削除される。
 * 成功後は Clerk 上のユーザーが存在しないため、呼び出し側はローカル状態を
 * 片付けて signOut まで行うこと（profile 画面の削除導線を参照）。
 */
export function useDeleteAccount() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.$delete({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "アカウントの削除に失敗しました");
      }
      return null;
    },
  });
}

export function useUpdateProfile() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.profile.$put({ json: input }, { headers });
      if (res.status === 400) {
        throw new ApiRequestError(400, "入力内容に誤りがあります");
      }
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "プロフィールの更新に失敗しました",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? profileQueryKey(userId) : PROFILE_QUERY_KEY,
      });
    },
  });
}
