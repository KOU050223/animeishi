import { useMutation } from "@tanstack/react-query";
import { apiClient, apiFetch } from "@/lib/api";
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
  return useMutation({
    mutationFn: async (input: SendFeedbackInput) => {
      const res = await apiClient.feedback.$post(
        { json: input },
        {
          fetch: apiFetch({
            onHttpError: async (errorRes) => {
              // 400（入力エラー）と 429（送信回数の上限）はサーバーの文言を
              // そのまま見せる。
              const body = (await errorRes.json().catch(() => null)) as {
                error?: string;
              } | null;
              if (errorRes.status === 400 || errorRes.status === 429) {
                return new ApiRequestError(
                  errorRes.status,
                  body?.error ?? "送信に失敗しました",
                );
              }
              return new ApiRequestError(errorRes.status, "送信に失敗しました");
            },
          }),
        },
      );
      return res.json();
    },
  });
}
