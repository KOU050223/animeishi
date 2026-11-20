import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

const workSchema = z.object({
  annictWorkId: z.number().int(),
  title: z.string(),
  hostedImageUrl: z.string().nullable(),
});

export const getCommonRoute = createRoute({
  method: "get",
  path: "/{id}/common",
  tags: ["common"],
  summary: "フレンドと共有する視聴記録と推しを取得する",
  security: bearerAuth,
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            watchingTogether: z.array(workSchema),
            watchedTogetherCount: z.number().int(),
            favoriteTogether: z.array(workSchema),
            conversationStarters: z.array(workSchema),
          }),
        },
      },
      description: "共通点。共通点が無ければ相手の今期視聴中を返す",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "未認証",
    },
    403: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "フレンドではない、またはブロック関係",
    },
  },
});
