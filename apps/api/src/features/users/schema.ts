import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// POST /users/:id/report のボディ。reason はプリセット理由ラベル or 自由入力を
// そのまま受ける（UGC モデレーション用の通報理由）。
export const reportCreateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "通報理由を入力してください")
    .max(500, "通報理由は500文字以内で入力してください"),
});

export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

// Clerk user ID（user_xxxxx）のパスパラメータ。
const userIdParamSchema = z.object({
  id: z.string().min(1).openapi({ example: "user_xxxxxxxxxxxx" }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// 通報レート制限（429）の応答。code で制限種別を区別する（issue #148）。
const reportRateLimitedSchema = z.object({
  error: z.string(),
  code: z.enum(["duplicate_target", "hourly_limit"]),
});

export const reportUserRoute = createRoute({
  method: "post",
  path: "/{id}/report",
  tags: ["users"],
  summary: "ユーザーを通報する",
  security: bearerAuth,
  request: {
    params: userIdParamSchema,
    body: {
      content: { "application/json": { schema: reportCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "通報を記録した",
    },
    400: jsonError("自分自身への通報・入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("対象ユーザーが存在しない"),
    429: {
      content: { "application/json": { schema: reportRateLimitedSchema } },
      description: "通報レート制限（Retry-After ヘッダ付き）",
    },
  },
});

export const blockUserRoute = createRoute({
  method: "post",
  path: "/{id}/block",
  tags: ["users"],
  summary: "ユーザーをブロックする（冪等）",
  security: bearerAuth,
  request: { params: userIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "ブロックした",
    },
    400: jsonError("自分自身へのブロック"),
    401: jsonError("未認証"),
    404: jsonError("対象ユーザーが存在しない"),
  },
});

export const unblockUserRoute = createRoute({
  method: "delete",
  path: "/{id}/block",
  tags: ["users"],
  summary: "ユーザーのブロックを解除する（冪等）",
  security: bearerAuth,
  request: { params: userIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "ブロックを解除した",
    },
    400: jsonError("自分自身へのブロック解除"),
    401: jsonError("未認証"),
  },
});
