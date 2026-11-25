import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "#src/lib/openapi";
import { userRateLimit } from "#src/middleware/rateLimit";

// POST /users/:id/report のボディ。reason はプリセット理由ラベル or 自由入力を
// そのまま受ける（UGC モデレーション用の通報理由）。
const reportCreateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "通報理由を入力してください")
    .max(500, "通報理由は500文字以内で入力してください"),
});

// Clerk user ID（user_xxxxx）のパスパラメータ。
const userIdParamSchema = z.object({
  id: z.string().min(1).openapi({ example: "user_xxxxxxxxxxxx" }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// 通報レート制限（429）の応答。code で制限種別を区別する（issue #148）。
// "rate_limited" は edge のユーザー単位流量制限（issue #715）で返す種別。
const reportRateLimitedSchema = z.object({
  error: z.string(),
  code: z.enum(["duplicate_target", "hourly_limit", "rate_limited"]),
});

export const reportUserRoute = createRoute({
  method: "post",
  path: "/{id}/report",
  tags: ["users"],
  summary: "ユーザーを通報する",
  security: bearerAuth,
  middleware: userRateLimit("REPORT_RATE_LIMITER"),
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

const publicUsersQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  // "<ソートキー>_<userId>"。user_id 自体が "_" を含むので
  // 先頭の数値 + "_" + 残り全部、という形にする。
  cursor: z
    .string()
    .regex(/^\d+_.+$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});

const publicUserIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" }, example: "user_xxx" }),
});

const publicUserJsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const userLikeResponse = {
  content: {
    "application/json": {
      schema: z.object({ likeCount: z.number(), likedByMe: z.boolean() }),
    },
  },
  description: "いいね後の件数と自分の状態",
};

export const listPublicUsersRoute = createRoute({
  method: "get",
  path: "/public",
  tags: ["users"],
  summary: "公開名刺の一覧を取得する",
  security: bearerAuth,
  request: { query: publicUsersQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                username: z.string(),
                profileImageUrl: z.string().nullable(),
                bio: z.string().nullable(),
                favoriteQuote: z.string().nullable(),
                genres: z.array(z.string()),
                likeCount: z.number(),
                likedByMe: z.boolean(),
                createdAt: z.string(),
                meishiSnapshotUrl: z.string().nullable(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
      description: "公開名刺の 1 ページ",
    },
    400: publicUserJsonError("入力エラー"),
    401: publicUserJsonError("未認証"),
  },
});

export const likeUserRoute = createRoute({
  method: "put",
  path: "/{id}/like",
  tags: ["users"],
  summary: "公開名刺にいいねする",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: publicUserIdParamSchema },
  responses: {
    200: userLikeResponse,
    400: publicUserJsonError("入力エラー・自分の名刺"),
    401: publicUserJsonError("未認証"),
    404: publicUserJsonError("公開ユーザーが見つからない"),
    429: publicUserJsonError("レート制限"),
  },
});

export const unlikeUserRoute = createRoute({
  method: "delete",
  path: "/{id}/like",
  tags: ["users"],
  summary: "公開名刺へのいいねを取り消す",
  security: bearerAuth,
  middleware: userRateLimit("LIKE_RATE_LIMITER"),
  request: { params: publicUserIdParamSchema },
  responses: {
    200: userLikeResponse,
    400: publicUserJsonError("入力エラー"),
    401: publicUserJsonError("未認証"),
    404: publicUserJsonError("公開ユーザーが見つからない"),
    429: publicUserJsonError("レート制限"),
  },
});
