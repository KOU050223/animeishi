import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferRequestType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { profileQueries, type ProfileResponse } from "@/lib/queries/profile";

export type Profile = ProfileResponse;

export type ProfileUpdateInput = InferRequestType<
  (typeof apiClient.me.profile)["$put"]
>["json"];

export const PROFILE_QUERY_KEY = profileQueries.all;

const profileQueryKey = (userId: string) => profileQueries.key(userId);

export function useProfile() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...profileQueries.me.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 退会フロー（issue #426）で消えるデータの件数（GET /me/deletion-summary）。
 */
export function useDeletionSummary() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...profileQueries.deletionSummary.query({ userId }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 退会理由の送信（POST /me/deletion-feedback）。
 * user_id と紐付けず集計専用で保存される。失敗しても退会をブロック
 * しない前提のため、呼び出し側はエラーを握り潰して進めてよい。
 * 無効化するキャッシュを持たない書き込みなので useMutation ではなく
 * 素の関数で呼び、完了待ち・タイムアウトは呼び出し側が制御する。
 */
export async function submitDeletionFeedback(input: {
  reasons: string[];
  freeText?: string;
}): Promise<void> {
  await apiClient.me["deletion-feedback"].$post(
    { json: input },
    { fetch: apiFetch({ errorMessage: "回答の送信に失敗しました" }) },
  );
}

/**
 * アカウント削除（DELETE /me）。
 * サーバー側で D1 のユーザーデータ・R2 アバター・Clerk ユーザー本体が削除される。
 * 成功後は Clerk 上のユーザーが存在しないため、呼び出し側はローカル状態を
 * 片付けて signOut まで行うこと（profile 画面の削除導線を参照）。
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      await apiClient.me.$delete(
        {},
        {
          fetch: apiFetch({
            errorMessage: "アカウントの削除に失敗しました",
          }),
        },
      );
      return null;
    },
  });
}

export function useUpdateProfile() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      const res = await apiClient.me.profile.$put(
        { json: input },
        {
          // 400 はバリデーションの具体的な理由（「ユーザー名に使用できない
          // 文字が含まれています」等）が {error} に入るので、標準の
          // ApiRequestError 化ではなく応答 body の文言をそのまま画面へ渡す。
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              const body = (await errorRes.json().catch(() => null)) as {
                error?: string;
              } | null;
              return new ApiRequestError(
                errorRes.status,
                body?.error ??
                  (errorRes.status === 400
                    ? "入力内容に誤りがあります"
                    : "プロフィールの更新に失敗しました"),
              );
            },
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userId ? profileQueryKey(userId) : PROFILE_QUERY_KEY,
      });
    },
  });
}
