import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

// GET /articles のクエリ。limit は 1 ページ件数の指定（サーバー側で
// 上限を設ける）。公開中の記事だけを published_at の新しい順に返す。
// limit は正の整数に限定する。
const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// 一覧の 1 件。body（本文 Markdown）は詳細のみで返すため含めない。
const articleListItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  coverImageUrl: z.string().nullable(),
  publishedAt: z.string(),
});

const listResponseSchema = z.object({
  items: z.array(articleListItemSchema),
});

// GET /articles/:slug の応答。body は記事の本文 Markdown。
const articleDetailSchema = z.object({
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  coverImageUrl: z.string().nullable(),
  publishedAt: z.string(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

// slug は URL セグメントにそのまま載るため、投入側
// （scripts/publish-article.mjs）と同じ [a-z0-9-] 系の文字だけを許す。
const slugParamSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug の形式が正しくありません"),
});

export const listArticlesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["articles"],
  summary: "公開中の特集記事を公開開始の新しい順に取得する",
  security: bearerAuth,
  request: { query: listQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listResponseSchema } },
      description: "公開中の記事（published_at 降順）",
    },
    400: jsonError("クエリが不正"),
    401: jsonError("未認証"),
  },
});

export const getArticleRoute = createRoute({
  method: "get",
  path: "/{slug}",
  tags: ["articles"],
  summary: "公開中の特集記事を 1 件取得する（本文 Markdown つき）",
  security: bearerAuth,
  request: { params: slugParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: articleDetailSchema } },
      description: "記事の詳細",
    },
    400: jsonError("slug の形式が不正"),
    401: jsonError("未認証"),
    404: jsonError("記事が存在しないか公開期間外"),
  },
});
