import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// GET /events のクエリ。limit は 1 ページ件数の指定（サーバー側で上限を
// 設ける）。公開中のイベントだけを会期開始の早い順に返す。
const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// 一覧の 1 件。body（説明文 Markdown）は詳細のみで返すため含めない。
// participating は認証ユーザーが「参加する」を表明しているか（issue #411。
// 表明は本人にしか見えないため、このフラグも本人の応答にだけ載る）。
const eventListItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  coverImageUrl: z.string().nullable(),
  location: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  participating: z.boolean(),
});

const listResponseSchema = z.object({
  items: z.array(eventListItemSchema),
});

// GET /events/:slug の応答。body は説明文 Markdown（省略可なので nullable）。
const eventDetailSchema = z.object({
  slug: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  location: z.string().nullable(),
  officialUrl: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  participating: z.boolean(),
});

// GET /events/:slug/exchanged-friends の 1 件。
// GET /me/friends の 1 件と同じ形（相手プロフィールを含む）。
const exchangedFriendItemSchema = z.object({
  friendId: z.string(),
  createdAt: z.string(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
});

const exchangedFriendsResponseSchema = z.object({
  items: z.array(exchangedFriendItemSchema),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// slug は URL セグメントにそのまま載るため、投入側
// （scripts/publish-event.mjs）と同じ [a-z0-9-] 系の文字だけを許す。
const slugParamSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug の形式が正しくありません"),
});

export const listEventsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["events"],
  summary: "公開中のイベントを会期開始の早い順に取得する",
  security: bearerAuth,
  request: { query: listQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listResponseSchema } },
      description: "公開中のイベント（starts_at 昇順）",
    },
    400: jsonError("クエリが不正"),
    401: jsonError("未認証"),
  },
});

export const getEventRoute = createRoute({
  method: "get",
  path: "/{slug}",
  tags: ["events"],
  summary: "公開中のイベントを 1 件取得する（説明文 Markdown つき）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: eventDetailSchema } },
      description: "イベントの詳細",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    404: jsonError("イベントが存在しないか公開期間外"),
  },
});

export const participateEventRoute = createRoute({
  method: "put",
  path: "/{slug}/participation",
  tags: ["events"],
  summary:
    "イベントへの「参加する」を表明する（冪等。本人にのみ見え、フレンドには公開されない）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "表明した（すでに表明済みでも成功）",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    404: jsonError("イベントが存在しないか公開期間外"),
  },
});

export const cancelParticipationRoute = createRoute({
  method: "delete",
  path: "/{slug}/participation",
  tags: ["events"],
  summary: "イベントへの参加表明を取り消す（冪等）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "取り消した（未表明でも成功）",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
  },
});

export const getExchangedFriendsRoute = createRoute({
  method: "get",
  path: "/{slug}/exchanged-friends",
  tags: ["events"],
  summary:
    "そのイベントの会期中にフレンド成立した相手を取得する（参加表明が必要。本人のみ）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: exchangedFriendsResponseSchema },
      },
      description: "会期中に成立したフレンド（成立時刻の降順）",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    403: jsonError("そのイベントに参加表明していない"),
    404: jsonError("イベントが存在しないか公開期間外"),
  },
});
