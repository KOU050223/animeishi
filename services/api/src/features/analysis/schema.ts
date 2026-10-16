import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

// 分析結果の応答形（GET /me/analysis・POST /me/analysis 共通）。
const analysisResultSchema = z.object({
  // Workers AI が生成した視聴傾向テキスト（日本語）。
  summary: z.string(),
  // VALID_GENRES から選ばれたおすすめジャンル（最大 5 件）。
  recommendedGenres: z.array(z.string()),
  // 生成完了時刻（ISO 8601）。
  generatedAt: z.string(),
  // 分析入力に含めた視聴履歴の件数。
  workCount: z.number().int(),
});

// 生成回数制限（429）の応答。Retry-After ヘッダに解放までの秒数を載せる。
const rateLimitedSchema = z.object({
  error: z.string(),
  code: z.enum(["generation_limit"]),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getAnalysisRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["analysis"],
  summary: "保存済みの視聴傾向分析を取得する",
  description:
    "直近の分析結果を返す。一度も実行していない（または生成中）の場合は null。",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ analysis: analysisResultSchema.nullable() }),
        },
      },
      description: "分析結果（未実行なら null）",
    },
    401: jsonError("未認証"),
  },
});

export const generateAnalysisRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["analysis"],
  summary: "視聴履歴を Workers AI で分析する",
  description:
    "視聴履歴を集計して Workers AI に投げ、傾向テキストとおすすめジャンルを返す。" +
    "入力が変わらない間は 24h キャッシュを返し（cached=true）、生成実行は" +
    "ユーザーごとに 24h あたり 5 回まで（超過時は 429 + Retry-After）。",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            analysis: analysisResultSchema,
            cached: z.boolean(),
          }),
        },
      },
      description: "分析結果（cached=true ならキャッシュ由来）",
    },
    400: jsonError("視聴履歴が空"),
    401: jsonError("未認証"),
    429: {
      content: { "application/json": { schema: rateLimitedSchema } },
      description: "生成回数制限（Retry-After ヘッダ付き）",
    },
    502: jsonError("Workers AI の生成に失敗"),
  },
});
