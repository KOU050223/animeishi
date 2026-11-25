import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";
import { ACTIVITY_TYPES } from "@/db/schema";

// GET /me/feed のクエリ。cursor は前ページ最後尾の活動 id、limit は 1 ページ
// 件数の指定（サーバー側で上限を設ける）。いずれも省略可。
// limit は正の整数に限定する（0 だと空ページで次ページへ進めなくなる）。
const feedQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d+$/, "cursor の形式が正しくありません")
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// フィード 1 件の actor（活動したフレンド）。
const actorSchema = z.object({
  userId: z.string(),
  username: z.string(),
  profileImageUrl: z.string().nullable(),
});

// 活動の対象作品。work を持たない活動（tier 表など）では null。
const workSchema = z.object({
  annictWorkId: z.number().int(),
  title: z.string(),
  titleEn: z.string().nullable(),
  hostedImageUrl: z.string().nullable(),
});

// 活動の 1 件。meta は type ごとの補足情報（watch_status: {state}、
// tier_list_*: {kind, season?, title}）。
const feedItemSchema = z.object({
  id: z.number().int(),
  type: z.enum(ACTIVITY_TYPES),
  createdAt: z.string(),
  actor: actorSchema,
  work: workSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});

// GET /me/feed の応答。nextCursor は次ページがあるとき最後尾の活動 id。
const feedResponseSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.number().int().nullable(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// ストーリーの 1 スライド（issue #266）。type は watch_status に限られるため
// 含めない。meta には視聴状態 {state} が入る（話数は活動データが持たない）。
const storyItemSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  work: workSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});

// ストーリー表示対象のフレンド。items は再生順（古い活動が先頭）。
const storyFriendSchema = z.object({
  actor: actorSchema,
  items: z.array(storyItemSchema),
});

// GET /me/feed/stories の応答。friends は最終活動が新しい順。
const watchStoriesResponseSchema = z.object({
  friends: z.array(storyFriendSchema),
});

export const getFeedRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["feed"],
  summary: "フレンドの活動フィードを新しい順に取得する",
  security: bearerAuth,
  request: { query: feedQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: feedResponseSchema } },
      description: "フレンドの活動（id 降順のカーソルページング）",
    },
    400: jsonError("クエリが不正"),
    401: jsonError("未認証"),
  },
});

export const getWatchStoriesRoute = createRoute({
  method: "get",
  path: "/stories",
  tags: ["feed"],
  summary: "直近24時間に視聴記録をつけたフレンドとその活動を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: watchStoriesResponseSchema } },
      description:
        "フレンドごとの watch_status 活動（ストーリー表示用。ページングなし）",
    },
    401: jsonError("未認証"),
  },
});
