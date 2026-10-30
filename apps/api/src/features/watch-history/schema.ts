import { z } from "zod";
import { ANNICT_STATUS_STATES } from "@/lib/annict/statusState";

export const watchHistoryUpsertSchema = z.object({
  state: z.enum(ANNICT_STATUS_STATES, {
    error: () => "有効なステータスを選択してください",
  }),
});

export type WatchHistoryUpsertInput = z.infer<typeof watchHistoryUpsertSchema>;

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
export const WATCH_HISTORY_BULK_MAX_ENTRIES = 3;

export const watchHistoryBulkSchema = z.object({
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

export type WatchHistoryBulkInput = z.infer<typeof watchHistoryBulkSchema>;
