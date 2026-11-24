import { createRoute, z } from "@hono/zod-openapi";
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  codedErrorResponseSchema,
  errorResponseSchema,
} from "@/lib/openapi";
import { DANIME_EPISODE_JOB_STATUSES } from "./schema.db";

// インポート対象の 1 作品。クライアント（WebView 注入 / ブックマークレット）が
// マイページ HTML から抽出し、話数単位の履歴を作品単位に集約済みのものを受け取る。
// targetState はクライアントが決める（コンプリート → WATCHED、履歴のみ → WATCHING）。
export const danimeMatchWorkSchema = z.object({
  // workId が取れないカードはクライアント側で `title:<タイトル>` の疑似キーを
  // 使うため、タイトル長 + プレフィックス分の余裕を持たせる。
  danimeWorkId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  targetState: z.enum(["WATCHED", "WATCHING"]),
});

export const danimeMatchRequestSchema = z.object({
  // 上限は異常なペイロードを弾くための頭打ち。issue #219 で発覚した
  // 500 件照合の CPU 爆発はスコアリングの前計算化（danime-core）で解決済み
  // なので、旧クライアント互換のため上限は従来の 500 を維持する。
  // 新しいクライアントは余裕を持って 100 件ずつ分割送信する
  // （mobile useDanimeImport）。
  works: z
    .array(danimeMatchWorkSchema)
    .min(1)
    .max(500, "一度に照合できるのは500作品までです"),
  // ユーザーの Annict ライブラリに登録済みの annictWorkId（任意）。
  // 入力タイトルが期数を明示しているとき「登録済みの別シーズン」を候補から
  // 外すためのヒントに使う。照合の絞り込み用途のみで、登録処理には使わない。
  registeredWorkIds: z.array(z.number().int().positive()).max(5000).optional(),
});

export type DanimeMatchRequestInput = z.infer<typeof danimeMatchRequestSchema>;

// --- 話単位の記録ジョブ（issue #477） ---
//
// クライアントが送るのは「作品照合で exact 確定した作品」と
// 「その作品ページから抽出した dアニメ話一覧」。Annict 話 ID の対応付けは
// サーバー（Workflow）側で Annict 話一覧と突き合わせて行うので、
// クライアントは任意の話 ID を直接指定できない。
export const danimeEpisodeJobEpisodeSchema = z.object({
  partId: z.string().trim().min(1).max(64),
  watched: z.boolean(),
  label: z.string().max(200),
  subtitle: z.string().max(500),
});

export const danimeEpisodeJobWorkSchema = z.object({
  danimeWorkId: z.string().trim().min(1).max(512),
  annictWorkId: z.number().int().positive(),
  episodes: z.array(danimeEpisodeJobEpisodeSchema).max(2000),
});

export const danimeEpisodeJobCreateSchema = z.object({
  // 作品単位の取り込み上限（danimeMatchRequestSchema.works と同程度）。
  works: z.array(danimeEpisodeJobWorkSchema).min(1).max(1000),
});

export type DanimeEpisodeJobCreateInput = z.infer<
  typeof danimeEpisodeJobCreateSchema
>;

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const codedJsonError = (description: string) => ({
  content: { "application/json": { schema: codedErrorResponseSchema } },
  description,
});

// @animeishi/danime-core の DanimeAnnictWork。
const danimeAnnictWorkSchema = z.object({
  annictWorkId: z.number(),
  nodeId: z.string().nullable(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  imageUrl: z.string().nullable(),
  malAnimeId: z.number().nullable(),
});

export const danimeMatchRoute = createRoute({
  method: "post",
  path: "/danime/match",
  tags: ["import"],
  summary: "dアニメストアの作品タイトル群を Annict 作品に照合する",
  description:
    "サブリクエスト予算を使い切った作品は status:pending で返す（クライアントが再送する）。",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: {
    body: {
      content: { "application/json": { schema: danimeMatchRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(
              danimeMatchWorkSchema.extend({
                status: z.enum(["exact", "candidates", "none", "pending"]),
                work: danimeAnnictWorkSchema.nullable(),
                candidates: z.array(danimeAnnictWorkSchema),
              }),
            ),
            stats: z.object({
              localPassSearches: z.number(),
              firstPassSearches: z.number(),
              secondPassSearches: z.number(),
              pending: z.number(),
              elapsedMs: z.number(),
              retries: z.number(),
            }),
          }),
        },
      },
      description: "照合結果（入力順）と検索の観測情報",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict 未連携"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
    503: codedJsonError("共用トークンが使えない（本人の Annict 連携が必要）"),
  },
});

const danimeEpisodeJobSchema = z.object({
  id: z.string(),
  status: z.enum(DANIME_EPISODE_JOB_STATUSES),
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  skipped: z.number(),
  unmatched: z.number(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createDanimeEpisodeJobRoute = createRoute({
  method: "post",
  path: "/episode-jobs",
  tags: ["import"],
  summary: "話単位の記録ジョブを登録する（実行中があれば既存を返す）",
  security: bearerAuth,
  request: {
    body: {
      content: {
        "application/json": { schema: danimeEpisodeJobCreateSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            job: danimeEpisodeJobSchema,
            created: z.boolean(),
          }),
        },
      },
      description: "実行中の既存ジョブ（created:false）",
    },
    201: {
      content: {
        "application/json": {
          schema: z.object({
            job: danimeEpisodeJobSchema.nullable(),
            created: z.boolean(),
          }),
        },
      },
      description: "新規に登録したジョブ（created:true）",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Web の Annict 連携が無い"),
    503: jsonError("バックグラウンド処理が利用できない"),
  },
});

export const getCurrentDanimeEpisodeJobRoute = createRoute({
  method: "get",
  path: "/episode-jobs/current",
  tags: ["import"],
  summary: "最新の記録ジョブの進捗を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ job: danimeEpisodeJobSchema.nullable() }),
        },
      },
      description: "最新ジョブ（無ければ null）",
    },
    401: jsonError("未認証"),
  },
});
