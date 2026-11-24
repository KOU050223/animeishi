import { createRoute, z } from "@hono/zod-openapi";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { WORK_RATINGS } from "@/db/schema";
import { annictWorkIdParamSchema } from "../works/schema";

// PUT /me/work-ratings/:annictWorkId のボディ。3 段階
// （bad=イマイチ / good=良い / great=最高。issue #416）。
export const workRatingUpsertSchema = z.object({
  rating: z.enum(WORK_RATINGS, {
    error: () => "有効な評価を選択してください",
  }),
});

export type WorkRatingUpsertInput = z.infer<typeof workRatingUpsertSchema>;

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getWorkRatingRoute = createRoute({
  method: "get",
  path: "/{annictWorkId}",
  tags: ["work-ratings"],
  summary: "作品への自分の評価を取得する",
  description:
    "D1 に評価が無く Annict 連携済みなら、Annict のレビュー評価を annictRating に初期値候補として返す。",
  security: bearerAuthWithAnnict,
  request: { params: annictWorkIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            rating: z.enum(WORK_RATINGS).nullable(),
            annictRating: z.enum(WORK_RATINGS).nullable(),
          }),
        },
      },
      description: "評価（未評価は null）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const putWorkRatingRoute = createRoute({
  method: "put",
  path: "/{annictWorkId}",
  tags: ["work-ratings"],
  summary: "作品を評価する（上書き）",
  security: bearerAuthWithAnnict,
  request: {
    params: annictWorkIdParamSchema,
    body: {
      content: { "application/json": { schema: workRatingUpsertSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            annictWorkId: z.number(),
            rating: z.enum(WORK_RATINGS),
          }),
        },
      },
      description: "保存した評価",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
    404: jsonError("作品が見つからない"),
  },
});

export const deleteWorkRatingRoute = createRoute({
  method: "delete",
  path: "/{annictWorkId}",
  tags: ["work-ratings"],
  summary: "作品への評価を取り消す",
  security: bearerAuth,
  request: { params: annictWorkIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "取り消した（未評価でも成功）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});
