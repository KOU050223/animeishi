import { createRoute, z } from "@hono/zod-openapi";
import { FEEDBACK_CATEGORIES } from "@/db/schema";
import {
  bearerAuth,
  errorResponseSchema,
  rateLimitedErrorResponse,
  successResponseSchema,
} from "@/lib/openapi";
import { userRateLimit } from "@/middleware/rateLimit";

const FEEDBACK_BODY_MAX_LENGTH = 2000;

const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES, {
    message: "Category is required",
  }),
  body: z
    .string()
    .trim()
    .min(1, "Body is required")
    .max(
      FEEDBACK_BODY_MAX_LENGTH,
      `Body must be ${FEEDBACK_BODY_MAX_LENGTH} characters or less`,
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
  middleware: userRateLimit("FEEDBACK_RATE_LIMITER"),
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
    429: rateLimitedErrorResponse("送信回数の上限"),
  },
});
