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
    // 1 リクエストで叩ける Annict updateStatus の上限。これを超える分は
    // クライアント側でチャンク分割して逐次送信する（進捗表示にも使う）。
    .max(50, "一度に登録できるのは50作品までです"),
});

export type WatchHistoryBulkInput = z.infer<typeof watchHistoryBulkSchema>;
