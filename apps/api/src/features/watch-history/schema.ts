import { createRoute, z } from "@hono/zod-openapi";
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  bearerAuth,
  bearerAuthWithAnnict,
  codedErrorResponseSchema,
  errorResponseSchema,
  successResponseSchema,
} from "@/lib/openapi";
import { WATCH_STATES } from "./schema.db";
import { ANNICT_STATUS_STATES } from "@/lib/annict/statusState";

export const watchHistoryUpsertSchema = z.object({
  state: z.enum(ANNICT_STATUS_STATES, {
    error: () => "有効なステータスを選択してください",
  }),
});

// 一括登録の 1 件。作品メタや nodeId は受け付けず、サーバー側で
// キャッシュ → Annict searchWorks の順に解決する。
// クライアントが食い違う nodeId/メタを送ると共有作品キャッシュ（annict_works）
// が汚染され updateStatus が別作品に向くため、ここでは信頼しない。
// 1 リクエストで処理できる登録件数の上限。これを超える分は
// クライアント側でチャンク分割して逐次送信する（進捗表示にも使う）。
//
// Workers のサブリクエスト上限（Free プラン 50/req、D1・KV・fetch・リトライ
// を全て数える。issue #219 の照合と同じ考え方）に、最悪ケースでも収める値:
// - 上限のうち ~10 は認証 D1・Clerk・障害通知（KV+Discord）・Sentry に確保し、
//   bulk 処理が使えるのは 40 まで
// - 現在ステータス一括取得: 1 クエリ × リトライ込み最大 3 試行 = 3
// - 作品 1 件あたり最大 11（D1 キャッシュ読み 1 + nodeId 解決の Annict
//   検索 3 試行 + updateStatus 3 試行 + 作品 upsert 1 + 履歴 upsert
//   UPDATE/INSERT/SELECT 3）
// → 3 + 11 × N ≤ 40 を満たす最大の N が 3。
const WATCH_HISTORY_BULK_MAX_ENTRIES = 3;

const watchHistoryBulkSchema = z.object({
  entries: z
    .array(
      z.object({
        annictWorkId: z.number().int().positive(),
        state: z.enum(ANNICT_STATUS_STATES, {
          error: () => "有効なステータスを選択してください",
        }),
      }),
    )
    .min(1)
    .max(
      WATCH_HISTORY_BULK_MAX_ENTRIES,
      `一度に登録できるのは${WATCH_HISTORY_BULK_MAX_ENTRIES}作品までです`,
    ),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const codedJsonError = (description: string) => ({
  content: { "application/json": { schema: codedErrorResponseSchema } },
  description,
});

// 不正値の 400 を {error:"Invalid annictWorkId"} で返すため、検証はハンドラ側で行う。
const annictWorkIdPathSchema = z.object({
  annictWorkId: z.string().openapi({ example: "12345" }),
});

const watchHistoryEntrySchema = z.object({
  id: z.number(),
  userId: z.string(),
  annictWorkId: z.number(),
  state: z.enum(WATCH_STATES),
  updatedAt: z.string(),
});

const watchHistoryWithWorkSchema = z.object({
  id: z.number(),
  userId: z.string(),
  annictWorkId: z.number(),
  state: z.enum(WATCH_STATES),
  updatedAt: z.string(),
  title: z.string(),
  titleKana: z.string().nullable(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  imageUrl: z.string().nullable(),
  resolvedImageUrl: z.string().nullable(),
  imageSource: z.string().nullable(),
  imageR2Key: z.string().nullable(),
  watchersCount: z.number().nullable(),
  genres: z.array(z.string()).nullable(),
  hostedImageUrl: z.string().nullable(),
});

const shareTokenResponse = (description: string) => ({
  content: {
    "application/json": {
      schema: z.object({ shareToken: z.string().nullable() }),
    },
  },
  description,
});

export const listWatchHistoryRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["watch-histories"],
  summary: "自分の視聴記録を取得する（Annict のライブラリと同期してから返す）",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(watchHistoryWithWorkSchema) },
      },
      description: "視聴記録（更新日時の降順）",
    },
    401: codedJsonError("未認証・Annict 未連携"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
  },
});

export const upsertWatchHistoryRoute = createRoute({
  method: "put",
  path: "/{annictWorkId}",
  tags: ["watch-histories"],
  summary: "作品の視聴ステータスを設定する（Annict にも反映）",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: {
    params: annictWorkIdPathSchema,
    body: {
      content: { "application/json": { schema: watchHistoryUpsertSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: watchHistoryEntrySchema } },
      description: "保存した視聴記録",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict 未連携"),
    404: jsonError("作品が見つからない"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
  },
});

export const bulkWatchHistoryRoute = createRoute({
  method: "post",
  path: "/bulk",
  tags: ["watch-histories"],
  summary: "複数作品の視聴ステータスをまとめて設定する",
  description:
    "作品ごとの成否を results で返す。Annict のトークン失効を検知したら残りを aborted として打ち切る。",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: {
    body: {
      content: { "application/json": { schema: watchHistoryBulkSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(
              z.union([
                z.object({ annictWorkId: z.number(), ok: z.literal(true) }),
                z.object({
                  annictWorkId: z.number(),
                  ok: z.literal(false),
                  error: z.string(),
                }),
              ]),
            ),
            aborted: z.boolean(),
            elapsedMs: z.number(),
          }),
        },
      },
      description: "作品ごとの結果（入力順）",
    },
    400: jsonError("入力エラー"),
    401: codedJsonError("未認証・Annict 未連携"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
  },
});

export const getWatchHistoryShareRoute = createRoute({
  method: "get",
  path: "/share",
  tags: ["watch-histories"],
  summary: "視聴記録の共有トークンを取得する",
  security: bearerAuth,
  responses: {
    200: shareTokenResponse("共有トークン（未共有なら null）"),
    401: jsonError("未認証"),
  },
});

export const shareWatchHistoryRoute = createRoute({
  method: "post",
  path: "/share",
  tags: ["watch-histories"],
  summary:
    "視聴記録を共有する（共有トークンを発行。発行済みなら同じものを返す）",
  security: bearerAuth,
  responses: {
    200: shareTokenResponse("共有トークン"),
    401: jsonError("未認証"),
    404: jsonError("ユーザーが存在しない"),
  },
});

export const unshareWatchHistoryRoute = createRoute({
  method: "delete",
  path: "/share",
  tags: ["watch-histories"],
  summary: "視聴記録の共有をやめる（共有トークンを失効）",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "共有をやめた",
    },
    401: jsonError("未認証"),
    404: jsonError("ユーザーが存在しない"),
  },
});

export const deleteWatchHistoryRoute = createRoute({
  method: "delete",
  path: "/{annictWorkId}",
  tags: ["watch-histories"],
  summary: "作品の視聴ステータスを外す（Annict でも未設定に戻す）",
  security: bearerAuthWithAnnict,
  middleware: [requireAnnictToken] as const,
  request: { params: annictWorkIdPathSchema },
  responses: {
    200: {
      content: { "application/json": { schema: successResponseSchema } },
      description: "外した",
    },
    400: jsonError("annictWorkId が不正"),
    401: codedJsonError("未認証・Annict 未連携"),
    404: jsonError("作品が見つからない"),
    429: codedJsonError("Annict のレート制限（混雑）"),
    502: codedJsonError("Annict の障害"),
  },
});
