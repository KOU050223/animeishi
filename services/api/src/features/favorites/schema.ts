import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";

// favorites 行（Drizzle Favorite 型の JSON 表現）。createdAt は ISO 文字列。
const favoriteSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  annictWorkId: z.number().int(),
  createdAt: z.string(),
});

// GET /me/favorites の 1 件。favorite + 作品メタ + hostedImageUrl
// （FavoriteWithWork に作品画像プロキシの配信 URL を載せたもの）。
const favoriteItemSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  annictWorkId: z.number().int(),
  createdAt: z.string(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  resolvedImageUrl: z.string().nullable(),
  imageSource: z.string().nullable(),
  imageR2Key: z.string().nullable(),
  hostedImageUrl: z.string().nullable(),
});

// パスパラメータは文字列のまま受け、数値変換と妥当性判定はハンドラ側で行う
// （不正値は従来どおり {error} の 400）。
const annictWorkIdParamSchema = z.object({
  annictWorkId: z.string().min(1).openapi({ example: "12345" }),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getFavoritesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["favorites"],
  summary: "自分のお気に入り一覧を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(favoriteItemSchema) } },
      description: "お気に入り一覧（登録日時の降順）",
    },
    401: jsonError("未認証"),
  },
});

export const addFavoriteRoute = createRoute({
  method: "post",
  path: "/{annictWorkId}",
  tags: ["favorites"],
  summary: "作品をお気に入りに追加する（冪等）",
  security: bearerAuth,
  request: { params: annictWorkIdParamSchema },
  responses: {
    201: {
      content: { "application/json": { schema: favoriteSchema } },
      description: "追加したお気に入り",
    },
    400: jsonError("annictWorkId が不正"),
    401: jsonError("未認証"),
    404: jsonError("作品が見つからない"),
  },
});

export const removeFavoriteRoute = createRoute({
  method: "delete",
  path: "/{annictWorkId}",
  tags: ["favorites"],
  summary: "お気に入りを解除する（冪等）",
  security: bearerAuth,
  request: { params: annictWorkIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "解除した",
    },
    400: jsonError("annictWorkId が不正"),
    401: jsonError("未認証"),
  },
});
