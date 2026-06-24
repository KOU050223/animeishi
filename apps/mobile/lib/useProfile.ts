import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferRequestType, InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";

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
      if (!res.ok) throw new Error("プロフィールの取得に失敗しました");
      return res.json();
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
      if (res.status === 400) throw new Error("入力内容に誤りがあります");
      if (!res.ok) throw new Error("プロフィールの更新に失敗しました");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? profileQueryKey(userId) : PROFILE_QUERY_KEY,
      });
    },
  });
}
