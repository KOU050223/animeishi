import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// POST /me/friends のボディ。friendId は相手の Clerk user ID。
export const friendCreateSchema = z.object({
  friendId: z.string().min(1, "friendId を指定してください"),
});

export type FriendCreateInput = z.infer<typeof friendCreateSchema>;

// friends 行（Drizzle Friend 型の JSON 表現）。createdAt は ISO 文字列。
const friendSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  friendId: z.string(),
  createdAt: z.string(),
});

// GET /me/friends の 1 件（FriendWithUser。相手プロフィールを含む）。
const friendItemSchema = z.object({
  friendId: z.string(),
  createdAt: z.string(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
});

const friendIdParamSchema = z.object({
  friendId: z.string().min(1).openapi({ example: "user_xxxxxxxxxxxx" }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getFriendsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["friends"],
  summary: "自分のフレンド一覧を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(friendItemSchema) } },
      description: "フレンド一覧（登録日時の降順）",
    },
    401: jsonError("未認証"),
  },
});

export const addFriendRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["friends"],
  summary: "フレンドを追加する（双方向・冪等）",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: friendCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: friendSchema } },
      description: "追加したフレンド",
    },
    400: jsonError("自分自身の追加・入力エラー"),
    401: jsonError("未認証"),
    403: jsonError("ブロック関係にある相手"),
    404: jsonError("対象ユーザーが存在しない"),
  },
});

export const removeFriendRoute = createRoute({
  method: "delete",
  path: "/{friendId}",
  tags: ["friends"],
  summary: "フレンドを解除する（双方向・冪等）",
  security: bearerAuth,
  request: { params: friendIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "解除した",
    },
    401: jsonError("未認証"),
  },
});
