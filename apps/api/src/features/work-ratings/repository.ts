import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { workRatings } from "@/db/schema";
import type { WorkRating, WorkRatingValue } from "@/db/schema";

/** 分析入力用の評価サマリ（作品 ID → 評価）。 */
export type MyWorkRating = {
  annictWorkId: number;
  rating: WorkRatingValue;
};

/**
 * workRatingsRepository: 認証済みユーザーIDを束縛した work_ratings
 * ドメインのリポジトリ層。
 * 評価は Animeishi 独自の値で、user × 作品で 1 行（upsert で上書き）。
 */
export function workRatingsRepository(db: DrizzleDb, currentUserId: string) {
  return {
    async getMyRating(annictWorkId: number): Promise<WorkRating | undefined> {
      return db.query.workRatings.findFirst({
        where: (t, { and: and_, eq: eq_ }) =>
          and_(eq_(t.userId, currentUserId), eq_(t.annictWorkId, annictWorkId)),
      });
    },

    /** AI 視聴傾向分析・おすすめの入力に使う、本人の全評価。 */
    async listMyRatings(): Promise<MyWorkRating[]> {
      return db.query.workRatings.findMany({
        columns: { annictWorkId: true, rating: true },
        where: eq(workRatings.userId, currentUserId),
      });
    },

    async upsertMyRating(
      annictWorkId: number,
      rating: WorkRatingValue,
    ): Promise<WorkRating> {
      const now = new Date();
      const [row] = await db
        .insert(workRatings)
        .values({
          userId: currentUserId,
          annictWorkId,
          rating,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [workRatings.userId, workRatings.annictWorkId],
          set: { rating, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error("評価の保存に失敗しました");
      return row;
    },

    async deleteMyRating(annictWorkId: number): Promise<void> {
      await db
        .delete(workRatings)
        .where(
          and(
            eq(workRatings.userId, currentUserId),
            eq(workRatings.annictWorkId, annictWorkId),
          ),
        );
    },
  };
}

export type WorkRatingsRepository = ReturnType<typeof workRatingsRepository>;
