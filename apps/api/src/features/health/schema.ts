import { createRoute, z } from "@hono/zod-openapi";

const healthResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2026-01-01T00:00:00.000Z" }),
  environment: z.string().nullable().openapi({ example: "preview" }),
  commitSha: z.string().nullable(),
  versionId: z.string().nullable(),
});

export const getHealthRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["health"],
  summary: "ヘルスチェック・デプロイバージョン情報",
  responses: {
    200: {
      content: { "application/json": { schema: healthResponseSchema } },
      description: "稼働中",
    },
  },
});
