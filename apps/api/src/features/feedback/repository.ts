import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { feedbacks } from "@/db/schema";
import type { FeedbackCreateInput } from "./schema";

export const FEEDBACK_HOURLY_LIMIT = 5;
const FEEDBACK_HOURLY_WINDOW_MS = 60 * 60 * 1000;

export class FeedbackRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `短時間に送信できる回数の上限に達しました。約${Math.ceil(retryAfterSeconds / 60)}分後にお試しください`,
    );
    this.name = "FeedbackRateLimitError";
  }
}

export function feedbackRepository(db: DrizzleDb, currentUserId: string) {
  return {
    // 件数確認と挿入を 1 文にまとめ、同時送信で上限をすり抜けないようにする
    // （通報の createReport と同じ理由。features/users/repository.ts を参照）。
    async create(input: FeedbackCreateInput): Promise<void> {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const sinceSec = Math.floor((nowMs - FEEDBACK_HOURLY_WINDOW_MS) / 1000);

      const inserted = await db.run(sql`
        INSERT INTO ${feedbacks} (
          user_id, category, body, app_version, platform, created_at
        )
        SELECT
          ${currentUserId}, ${input.category}, ${input.body},
          ${input.appVersion || null}, ${input.platform || null}, ${nowSec}
        WHERE (
          SELECT COUNT(*) FROM ${feedbacks}
          WHERE user_id = ${currentUserId} AND created_at > ${sinceSec}
        ) < ${FEEDBACK_HOURLY_LIMIT}
      `);

      if (inserted.meta.changes === 0) {
        const oldest = await db.get<{ created_at: number }>(sql`
          SELECT created_at FROM ${feedbacks}
          WHERE user_id = ${currentUserId} AND created_at > ${sinceSec}
          ORDER BY created_at ASC LIMIT 1
        `);
        const retryAfterMs = oldest
          ? oldest.created_at * 1000 + FEEDBACK_HOURLY_WINDOW_MS - nowMs
          : FEEDBACK_HOURLY_WINDOW_MS;
        throw new FeedbackRateLimitError(
          Math.max(1, Math.ceil(retryAfterMs / 1000)),
        );
      }
    },
  };
}
