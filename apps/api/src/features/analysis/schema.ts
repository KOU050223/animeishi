import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";
import { WATCH_STATES } from "@/db/schema";

// レポートの 1 項目（issue #375）。facts・evidenceWorks はサーバー側で
// 集計した確定値（AI の出力ではない）。insight は AI の解釈文で、
// 生成できなかった場合はサーバー側の事実文が入る。
const analysisSectionSchema = z.object({
  // 項目の識別子（"genres" | "seasons" | "completion" | "popularity"）。
  key: z.string(),
  // 項目名（日本語）。
  title: z.string(),
  // 項目への解釈文（日本語）。
  insight: z.string(),
  // 傾向の根拠となった集計値（"12 件（30%）" などの表示用整形済み文字列）。
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  // 傾向の根拠となったライブラリ内の作品（最大 3 件）。
  evidenceWorks: z.array(
    z.object({
      annictWorkId: z.number().int(),
      title: z.string(),
      state: z.enum(WATCH_STATES),
    }),
  ),
});

// 分析結果の応答形（GET /me/analysis・POST /me/analysis 共通）。
const analysisResultSchema = z.object({
  // Workers AI が生成した視聴傾向テキスト（日本語）。
  summary: z.string(),
  // VALID_GENRES から選ばれたおすすめジャンル（最大 5 件）。
  recommendedGenres: z.array(z.string()),
  // レポート項目（issue #375）。レポート形式になる前の結果では空配列。
  sections: z.array(analysisSectionSchema),
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

// おすすめ 1 作品の応答形（issue #335）。
const recommendedWorkSchema = z.object({
  annictWorkId: z.number().int(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  // Annict のシーズン区分（"2026-spring" 形式）と放送年。
  seasonName: z.string().nullable(),
  seasonYear: z.number().int().nullable(),
  // 作品画像プロキシの URL。未取得・解決失敗時は null（クライアントは
  // プレースホルダー表示）。
  hostedImageUrl: z.string().nullable(),
  // AI が生成したおすすめ理由（日本語）。空文字の場合は UI で非表示にする。
  reason: z.string(),
});

// おすすめ結果の応答形（GET・POST 共通）。works は生成時の候補順を維持する。
const recommendationResultSchema = z.object({
  works: z.array(recommendedWorkSchema),
  generatedAt: z.string(),
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
    "視聴履歴をサーバー側で集計して Workers AI に投げ、傾向テキストと" +
    "おすすめジャンルに加え、根拠データ付きのレポート項目（sections）を返す。" +
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
      headers: z.object({ "Retry-After": z.string() }),
      content: { "application/json": { schema: rateLimitedSchema } },
      description: "生成回数制限（Retry-After ヘッダ付き）",
    },
    502: jsonError("Workers AI の生成に失敗"),
  },
});

export const getRecommendationsRoute = createRoute({
  method: "get",
  path: "/recommendations",
  tags: ["analysis"],
  summary: "保存済みの AI おすすめ作品を取得する",
  description:
    "直近のおすすめ生成結果を返す。一度も実行していない（または生成中）の場合は null。" +
    "Annict トークンは不要（保存済みデータを返すだけ）。",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            recommendations: recommendationResultSchema.nullable(),
          }),
        },
      },
      description: "おすすめ結果（未実行なら null）",
    },
    401: jsonError("未認証"),
  },
});

export const generateRecommendationsRoute = createRoute({
  method: "post",
  path: "/recommendations",
  tags: ["analysis"],
  summary: "視聴履歴からおすすめ作品を生成する",
  description:
    "視聴履歴（＋保存済みの分析結果があればそれ）を入力に Workers AI で" +
    "おすすめ候補を生成し、Annict searchWorks で実在する作品に照合して、" +
    "本人の視聴履歴に無い作品だけを返す。入力が変わらない間は 24h キャッシュを" +
    "返し（cached=true）、生成実行はユーザーごとに 24h あたり 5 回まで" +
    "（超過時は 429 + Retry-After）。Annict 連携が必要（未連携は 401）。",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            recommendations: recommendationResultSchema,
            cached: z.boolean(),
          }),
        },
      },
      description: "おすすめ結果（cached=true ならキャッシュ由来）",
    },
    400: jsonError("視聴履歴が空"),
    401: jsonError("未認証 / Annict 連携が必要"),
    429: {
      headers: z.object({ "Retry-After": z.string() }),
      content: { "application/json": { schema: rateLimitedSchema } },
      description: "生成回数制限（Retry-After ヘッダ付き）",
    },
    502: jsonError("Workers AI または Annict との通信に失敗"),
  },
});
