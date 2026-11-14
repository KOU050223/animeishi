import { createRoute, z } from "@hono/zod-openapi";
import { FEEDBACK_CATEGORIES } from "@/db/schema";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

export const FEEDBACK_BODY_MAX_LENGTH = 2000;

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES, {
    message: "種類を選択してください",
  }),
  body: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(
      FEEDBACK_BODY_MAX_LENGTH,
      `内容は${FEEDBACK_BODY_MAX_LENGTH}文字以内で入力してください`,
    ),
  appVersion: z.string().trim().max(100).optional(),
  platform: z.string().trim().max(100).optional(),
});

export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const createFeedbackRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["feedback"],
  summary: "不具合報告・ご意見を送る",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: feedbackCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "受け付けた",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    429: jsonError("送信回数の上限（Retry-After ヘッダ付き）"),
  },
});
