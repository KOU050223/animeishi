import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// API 側（db/schema.ts の FEEDBACK_CATEGORIES、features/feedback/schema.ts）と揃える。
export type FeedbackCategory = "bug" | "request" | "other";

export const FEEDBACK_BODY_MAX_LENGTH = 2000;

export type SendFeedbackInput = {
  category: FeedbackCategory;
  body: string;
  appVersion?: string;
  platform?: string;
};

export function useSendFeedback() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (input: SendFeedbackInput) => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const res = await apiClient.feedback.$post(
        { json: input },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        // 400（入力エラー）と 429（送信回数の上限）はサーバーの文言をそのまま見せる。
        if (res.status === 400 || res.status === 429) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new ApiRequestError(
            res.status,
            body?.error ?? "送信に失敗しました",
          );
        }
        throw new ApiRequestError(res.status, "送信に失敗しました");
      }
      return res.json();
    },
  });
}
