import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// POST /me/friends のボディ。friendId は相手の Clerk user ID。
// qrToken は相手が画面に表示した対面交換 QR に埋め込まれた短期トークン
// （GET /me/friends/qr-token で相手が発行したもの）。即時成立は QR を
// 読み合った対面交換に限るため必須で、無い・無効・期限切れは 403。
// リモートからの追加は /me/friend-requests の申請フローを使う（issue #417）。
// offlineToken はオフライン交換用の長寿命トークン（issue #663）。どちらか
// 一方でも検証を通れば即時成立する。
export const friendCreateSchema = z.object({
  friendId: z.string().min(1, "friendId を指定してください"),
  qrToken: z.string().min(1).optional(),
  offlineToken: z.string().min(1).optional(),
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
// source は交換経路（issue #411）。meishiSnapshotUrl は相手の既定名刺の
// 公開スナップショット（issue #593）の配信 URL。名刺帳（issue #659）で
// 名刺そのものを並べるために返す。スナップショット未作成なら null。
const friendItemSchema = z.object({
  friendId: z.string(),
  createdAt: z.string(),
  source: z.enum(["qr", "request"]).nullable(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  meishiSnapshotUrl: z.string().nullable(),
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

// GET /me/friends/qr-token の応答。expiresAt は UNIX 秒。
// offlineToken はオフライン交換用の長寿命トークン（issue #663）。
// 表示側がオフラインで qt を取れないとき QR のフォールバックに使うため、
// オンラインのうちにクライアントへ渡しておく。
const qrTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.number().int(),
  offlineToken: z.string(),
  offlineExpiresAt: z.number().int(),
});

export const getQrTokenRoute = createRoute({
  method: "get",
  path: "/qr-token",
  tags: ["friends"],
  summary:
    "対面 QR 交換用のトークンを発行する（自分の QR に埋め込む。qt は約 5 分、ot は 24 時間有効）",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: qrTokenSchema } },
      description: "発行したトークン",
    },
    401: jsonError("未認証"),
  },
});

export const addFriendRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["friends"],
  summary:
    "対面 QR 交換でフレンドを即時追加する（双方向・冪等。qrToken または offlineToken 必須）",
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
    403: {
      content: {
        "application/json": {
          // QR トークン不備のときだけ code=qr_exchange_required を返し、
          // クライアントはこれを見て申請フローへフォールバックする。
          schema: errorResponseSchema.extend({
            code: z.string().optional(),
          }),
        },
      },
      description:
        "ブロック関係にある相手 / qrToken・offlineToken が無い・無効・期限切れ",
    },
    404: jsonError("対象ユーザーが存在しない"),
  },
});

// 名刺帳の私用メモ（issue #659）の応答。メモ未作成・空で消した直後は
// 両方 null の 200 を返す（404 は「フレンドでない」場合だけ）。
const friendNoteSchema = z.object({
  body: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

// PUT /me/friends/{friendId}/note のボディ。500 文字まで。
// 空文字・空白のみは「メモを消す」として扱う（空行を残さない）。
export const friendNoteUpdateSchema = z.object({
  body: z.string().max(500, "メモは 500 文字以内で入力してください"),
});

export const getFriendNoteRoute = createRoute({
  method: "get",
  path: "/{friendId}/note",
  tags: ["friends"],
  summary:
    "相手の私用メモを取得する（名刺帳・本人のみ。フレンドでなければ 404）",
  security: bearerAuth,
  request: { params: friendIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: friendNoteSchema } },
      description: "私用メモ（未作成なら body/updatedAt は null）",
    },
    401: jsonError("未認証"),
    404: jsonError("フレンドではない（またはユーザーが存在しない）"),
  },
});

export const putFriendNoteRoute = createRoute({
  method: "put",
  path: "/{friendId}/note",
  tags: ["friends"],
  summary:
    "相手の私用メモを上書き保存する（500 文字まで。空文字は削除。フレンドでなければ 404）",
  security: bearerAuth,
  request: {
    params: friendIdParamSchema,
    body: {
      content: { "application/json": { schema: friendNoteUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: friendNoteSchema } },
      description: "保存したメモ（空文字なら削除され body/updatedAt は null）",
    },
    400: jsonError("メモが 500 文字を超えるなどの入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("フレンドではない（またはユーザーが存在しない）"),
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
