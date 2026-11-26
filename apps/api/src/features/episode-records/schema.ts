import { createRoute, z } from "@hono/zod-openapi";
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  annictRateLimitedResponse,
  annictUpstreamErrorResponse,
  bearerAuthWithAnnict,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { annictWorkIdParamSchema } from "../works/schema";

// /me/episode-records/:annictEpisodeId 系パスのパラメータ。
// パスパラメータは文字列なので coerce。
const annictEpisodeIdParamSchema = z.object({
  annictEpisodeId: z.coerce.number().int().positive(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const recordEpisodeRoute = createRoute({
  method: "put",
  path: "/{annictEpisodeId}",
  tags: ["episode-records"],
  summary: "話を記録する（記録済みなら何もしない）",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: { params: annictEpisodeIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            recorded: z.boolean(),
            annictRecordId: z.number().nullable(),
            recordedAt: z.string().nullable(),
          }),
        },
      },
      description: "記録結果（記録済みだった場合は recorded:false）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証・Annict 未連携"),
    404: jsonError("話が見つからない"),
    429: annictRateLimitedResponse,
    502: annictUpstreamErrorResponse,
  },
});

export const unrecordEpisodeRoute = createRoute({
  method: "delete",
  path: "/{annictEpisodeId}",
  tags: ["episode-records"],
  summary: "話のチェックを外す（その話の記録を全件消す）",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: { params: annictEpisodeIdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "消した",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証・Annict 未連携"),
    404: jsonError("話が見つからない"),
    429: annictRateLimitedResponse,
    502: annictUpstreamErrorResponse,
  },
});

export const getWorkEpisodesRoute = createRoute({
  method: "get",
  path: "/{annictWorkId}/episodes",
  tags: ["works"],
  summary: "作品の話数一覧と自分の記録状況を取得する",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: { params: annictWorkIdParamSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            episodes: z.array(
              z.object({
                annictEpisodeId: z.number(),
                number: z.number().nullable(),
                numberText: z.string().nullable(),
                sortNumber: z.number(),
                title: z.string().nullable(),
                watched: z.boolean(),
                recordsCount: z.number(),
                lastRecordedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "話数一覧（sortNumber 順）",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証・Annict 未連携"),
    404: jsonError("作品が見つからない"),
    429: annictRateLimitedResponse,
    502: annictUpstreamErrorResponse,
  },
});
