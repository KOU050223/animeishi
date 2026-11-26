import { useMutation } from "@tanstack/react-query";
import { apiClient, apiFetch } from "@/lib/api";
import {
  ApiRequestError,
  readApiErrorCode,
  readRetryAfterSeconds,
} from "@/lib/apiError";
import { apiErrorMessage } from "@/lib/apiErrorMessages";

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
              // サーバーの error は開発者向け英語なので画面には出さず、
              // code から表示文言を引く（429 は画面側がステータスで
              // 文言を出し分ける。issue #838）。
              const code = await readApiErrorCode(errorRes);
              return new ApiRequestError(
                errorRes.status,
                apiErrorMessage(code) ?? "送信に失敗しました",
                code,
                readRetryAfterSeconds(errorRes),
              );
            },
          }),
        },
      );
      return res.json();
    },
  });
}
