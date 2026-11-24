import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuthWithAnnict, errorResponseSchema } from "@/lib/openapi";
import { ACHIEVEMENT_KINDS } from "./definitions";

// 実績 1 件（service.ts の Achievement の JSON 表現）。
const achievementSchema = z.object({
  id: z.string(),
  kind: z.enum(ACHIEVEMENT_KINDS),
  threshold: z.number().nullable(),
  earned: z.boolean(),
  available: z.boolean(),
  progress: z.object({
    current: z.number(),
    target: z.number().nullable(),
  }),
  work: z.object({ annictWorkId: z.number(), title: z.string() }).optional(),
});

export const getAchievementsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["achievements"],
  summary: "実績（バッジ）一覧を取得する",
  description:
    "今期完走は Annict の話数マスタで判定するため、未連携・Annict 障害時はそのバッジだけ available:false になる。",
  security: bearerAuthWithAnnict,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            achievements: z.array(achievementSchema),
            season: z.string().openapi({ example: "2026-autumn" }),
            stats: z.object({
              watchedCount: z.number(),
              currentStreakWeeks: z.number(),
              bestStreakWeeks: z.number(),
            }),
          }),
        },
      },
      description: "実績一覧と集計値",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "未認証",
    },
  },
});
