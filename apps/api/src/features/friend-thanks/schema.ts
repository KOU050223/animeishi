import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { FRIEND_THANKS_PRESET_KEYS } from "@/db/schema";

// 名刺交換後のお礼（issue #694）。チャットではなく、フレンドへ
// 「定型文 1 つ＋任意の 1 行」を送る一方通行のメッセージ。
// presetKey は表示文言ではなくキーで持ち、表示側が受け手の言語で
// 翻訳する（ja / en）。同じ相手へは日本時間の暦日で 1 日 1 通まで
// （#662 の「同日は 1 回」と同じ JST 基準）。

/** 任意の 1 行の最大文字数。改行は不可。 */
const FRIEND_THANKS_BODY_MAX_LENGTH = 60;

// お礼 1 件の共通形。userId / username / profileImageUrl は相手
// （received では送り手、sent では受け手）のプロフィール。
const thanksItemBase = {
  id: z.number().int(),
  userId: z.string(),
  username: z.string(),
  profileImageUrl: z.string().nullable(),
  presetKey: z.enum(FRIEND_THANKS_PRESET_KEYS),
  body: z.string().nullable(),
  createdAt: z.string(),
};

// 届いたお礼。readAt は受け手が開いた時刻（未読なら null）で、
// 受け手側の未読表示にだけ使う。
const receivedThanksItemSchema = z.object({
  ...thanksItemBase,
  readAt: z.string().nullable(),
});

// 送ったお礼。既読は受け手側の未読表示のためだけに使うため、
// 送り手には readAt を返さない（issue #694「既読を送り手に
// 見せること」はスコープ外）。
const sentThanksItemSchema = z.object(thanksItemBase);

const thanksIdParamSchema = z.object({
  thanksId: z.coerce.number().int().positive().openapi({ example: 1 }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// GET /me/friend-thanks の応答。届いた・送った両方を新しい順で返す。
const friendThanksListSchema = z.object({
  received: z.array(receivedThanksItemSchema),
  sent: z.array(sentThanksItemSchema),
});

export const getFriendThanksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["friend-thanks"],
  summary: "届いた・送ったお礼の一覧を取得する（本人のみ。第三者には返さない）",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: friendThanksListSchema } },
      description: "届いたお礼（received）と送ったお礼（sent）、各新しい順",
    },
    401: jsonError("未認証"),
  },
});

// POST /me/friend-thanks のボディ。friendId は送る相手の Clerk user ID。
// presetKey は必須（定型文を 1 つ選ぶ）、body は任意の 1 行
// （60 文字まで・改行不可・空文字や空白のみは未入力として扱う）。
const friendThanksSendSchema = z.object({
  friendId: z.string().min(1, "friendId を指定してください"),
  presetKey: z.enum(FRIEND_THANKS_PRESET_KEYS),
  body: z
    .string()
    .max(
      FRIEND_THANKS_BODY_MAX_LENGTH,
      `ひとことは ${FRIEND_THANKS_BODY_MAX_LENGTH} 文字以内で入力してください`,
    )
    .refine((s) => !/[\r\n]/.test(s), "ひとことに改行は使えません")
    .nullable()
    .default(null),
});

export const sendFriendThanksRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["friend-thanks"],
  summary:
    "フレンドにお礼を送る（定型文 1 つ＋任意の 1 行。日本時間の 1 日 1 通まで。フレンドでなければ 404、同日再送は 409）",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: friendThanksSendSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: sentThanksItemSchema } },
      description: "送ったお礼",
    },
    400: jsonError("入力エラー（定型文キー・ひとことの形式）"),
    401: jsonError("未認証"),
    404: jsonError("フレンドではない（ブロック関係も含む）"),
    409: {
      content: {
        "application/json": {
          // 日本時間の暦日で既に送っているとき code=daily_limit を返す。
          // クライアントはこれを見て「今日はもう送っています」を出す。
          schema: errorResponseSchema.extend({
            code: z.string().optional(),
          }),
        },
      },
      description: "同じ相手へ日本時間の同日に再送した",
    },
  },
});

// POST /me/friend-thanks/read のボディ。friendId を指定するとその相手
// からの未読だけを既読にし、省略すると全ての届いた未読を既読にする。
// 「開いたら既読にする」タイミング（届いたお礼一覧・相手の詳細を開いた
// とき）にクライアントが呼ぶ。
const friendThanksReadSchema = z.object({
  friendId: z.string().min(1).optional(),
});

export const readFriendThanksRoute = createRoute({
  method: "post",
  path: "/read",
  tags: ["friend-thanks"],
  summary:
    "届いたお礼を既読にする（friendId 指定でその相手からの分だけ。受け手本人のみ）",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: friendThanksReadSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "既読にした",
    },
    401: jsonError("未認証"),
  },
});

export const deleteFriendThanksRoute = createRoute({
  method: "delete",
  path: "/{thanksId}",
  tags: ["friend-thanks"],
  summary: "送ったお礼を取り消す（送り手本人のみ。他人のお礼は 404）",
  security: bearerAuth,
  request: { params: thanksIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "削除した",
    },
    401: jsonError("未認証"),
    404: jsonError("お礼が存在しない（または自分が送ったものではない）"),
  },
});
