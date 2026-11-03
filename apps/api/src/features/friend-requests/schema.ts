import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// POST /me/friend-requests のボディ。userId は申請先（addressee）の Clerk user ID。
export const friendRequestCreateSchema = z.object({
  userId: z.string().min(1, "userId を指定してください"),
});

export type FriendRequestCreateInput = z.infer<
  typeof friendRequestCreateSchema
>;

// friend_requests 行（Drizzle FriendRequest 型の JSON 表現）。createdAt は ISO 文字列。
const friendRequestSchema = z.object({
  id: z.number().int(),
  requesterId: z.string(),
  addresseeId: z.string(),
  createdAt: z.string(),
});

// GET /me/friend-requests の 1 件。userId は相手側のユーザー ID
// （received では requester、sent では addressee）で、相手プロフィールを含む。
const friendRequestItemSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  createdAt: z.string(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
});

// POST /me/friend-requests の応答。相手からの申請がすでにあれば
// 相互意思とみなして即座にフレンド成立（"accepted"）し、なければ申請中
// （"pending"）として request を返す。
const sendFriendRequestResultSchema = z.object({
  status: z.enum(["pending", "accepted"]),
  request: friendRequestSchema.nullable(),
});

const requestIdParamSchema = z.object({
  id: z.coerce.number().int().positive().openapi({ example: 1 }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getFriendRequestsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["friend-requests"],
  summary: "自分のフレンド申請一覧を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            received: z.array(friendRequestItemSchema),
            sent: z.array(friendRequestItemSchema),
          }),
        },
      },
      description: "届いた申請（received）と送った申請（sent）",
    },
    401: jsonError("未認証"),
  },
});

export const sendFriendRequestRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["friend-requests"],
  summary: "フレンド申請を送る（冪等）。相手からの申請済みなら即成立",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: friendRequestCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: sendFriendRequestResultSchema },
      },
      description: "申請結果（pending: 申請中 / accepted: 相互申請で即成立）",
    },
    400: jsonError("自分自身への申請・入力エラー"),
    401: jsonError("未認証"),
    403: jsonError("ブロック関係にある相手"),
    404: jsonError("対象ユーザーが存在しない"),
    409: jsonError("すでにフレンド"),
  },
});

export const acceptFriendRequestRoute = createRoute({
  method: "post",
  path: "/{id}/accept",
  tags: ["friend-requests"],
  summary: "届いたフレンド申請を承認する",
  security: bearerAuth,
  request: { params: requestIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "承認した（フレンド成立）",
    },
    401: jsonError("未認証"),
    403: jsonError("ブロック関係にある相手"),
    404: jsonError("申請が存在しない・自分宛ではない"),
  },
});

export const deleteFriendRequestRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["friend-requests"],
  summary:
    "フレンド申請を削除する（受信者の拒否・送信者の取消。冪等性は無く 404）",
  security: bearerAuth,
  request: { params: requestIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "削除した",
    },
    401: jsonError("未認証"),
    404: jsonError("申請が存在しない・当事者ではない"),
  },
});
