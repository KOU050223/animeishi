// dアニメ話記録ジョブ（issue #477）の D1 リポジトリ。
// API（ジョブ作成・進捗参照）と Workflow（対応付け・書き込み・進捗記録）の
// 両方から使う。状態遷移はジョブ表・アイテム表を直接更新し、画面側の
// ポーリングはこの表を見る。
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  danimeEpisodeImportItems,
  danimeEpisodeImportJobs,
  danimeEpisodeImportWorks,
} from "@/db/schema";
import type {
  DanimeEpisodeImportItem,
  DanimeEpisodeImportJob,
  DanimeEpisodeImportWork,
  DanimeEpisodeItemStatus,
  DanimeEpisodeJobStatus,
} from "@/db/schema";

// 「実行中」として新規ジョブ作成を拒否する状態。matching は話対応付け中、
// writing は Annict への書き込み中。
export const RUNNING_JOB_STATUSES: readonly DanimeEpisodeJobStatus[] = [
  "matching",
  "writing",
];

export function episodeImportJobRepository(db: DrizzleDb) {
  return {
    async createJob(id: string, userId: string): Promise<void> {
      const now = new Date();
      await db.insert(danimeEpisodeImportJobs).values({
        id,
        userId,
        status: "matching",
        createdAt: now,
        updatedAt: now,
      });
    },

    async getJob(id: string): Promise<DanimeEpisodeImportJob | undefined> {
      return db.query.danimeEpisodeImportJobs.findFirst({
        where: eq(danimeEpisodeImportJobs.id, id),
      });
    },

    /** 最新のジョブ（進捗表示用。完了・失敗済みでも直近 1 件を返す）。 */
    async getLatestJobForUser(
      userId: string,
    ): Promise<DanimeEpisodeImportJob | undefined> {
      return db.query.danimeEpisodeImportJobs.findFirst({
        where: eq(danimeEpisodeImportJobs.userId, userId),
        orderBy: desc(danimeEpisodeImportJobs.createdAt),
      });
    },

    /** 実行中のジョブ（新規作成を拒否するかの判定用）。 */
    async getRunningJobForUser(
      userId: string,
    ): Promise<DanimeEpisodeImportJob | undefined> {
      return db.query.danimeEpisodeImportJobs.findFirst({
        where: and(
          eq(danimeEpisodeImportJobs.userId, userId),
          inArray(danimeEpisodeImportJobs.status, [...RUNNING_JOB_STATUSES]),
        ),
        orderBy: desc(danimeEpisodeImportJobs.createdAt),
      });
    },

    async insertJobWorks(
      rows: {
        jobId: string;
        danimeWorkId: string;
        annictWorkId: number;
        episodesJson: string;
      }[],
    ): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(danimeEpisodeImportWorks).values(rows);
    },

    async listJobWorks(jobId: string): Promise<DanimeEpisodeImportWork[]> {
      return db
        .select()
        .from(danimeEpisodeImportWorks)
        .where(eq(danimeEpisodeImportWorks.jobId, jobId))
        .orderBy(asc(danimeEpisodeImportWorks.id));
    },

    async insertJobItems(
      rows: {
        jobId: string;
        annictWorkId: number;
        annictEpisodeId: number;
        episodeNodeId: string;
        status: DanimeEpisodeItemStatus;
      }[],
    ): Promise<void> {
      if (rows.length === 0) return;
      const now = new Date();
      await db
        .insert(danimeEpisodeImportItems)
        .values(rows.map((r) => ({ ...r, updatedAt: now })));
    },

    /** 書き込み待ちのアイテムを挿入順に取る（Workflow の再実行でも pending のみ）。 */
    async listPendingItems(
      jobId: string,
      limit: number,
    ): Promise<DanimeEpisodeImportItem[]> {
      return db
        .select()
        .from(danimeEpisodeImportItems)
        .where(
          and(
            eq(danimeEpisodeImportItems.jobId, jobId),
            eq(danimeEpisodeImportItems.status, "pending"),
          ),
        )
        .orderBy(asc(danimeEpisodeImportItems.id))
        .limit(limit);
    },

    async setItemStatus(
      id: number,
      status: DanimeEpisodeItemStatus,
      error?: string,
    ): Promise<void> {
      await db
        .update(danimeEpisodeImportItems)
        .set({ status, error: error ?? null, updatedAt: new Date() })
        .where(eq(danimeEpisodeImportItems.id, id));
    },

    async setJobStatus(
      jobId: string,
      status: DanimeEpisodeJobStatus,
      error?: string,
    ): Promise<void> {
      await db
        .update(danimeEpisodeImportJobs)
        .set({ status, error: error ?? null, updatedAt: new Date() })
        .where(eq(danimeEpisodeImportJobs.id, jobId));
    },

    /**
     * カウンタを加算しつつ status も更新できる更新。
     * Workflow のステップごとに呼び、画面の進捗表示が最新値を読めるようにする。
     */
    async updateJobProgress(
      jobId: string,
      counts: {
        total?: number;
        done?: number;
        failed?: number;
        skipped?: number;
        unmatched?: number;
      },
      status?: DanimeEpisodeJobStatus,
    ): Promise<void> {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (status) set.status = status;
      if (counts.total)
        set.total = sql`${danimeEpisodeImportJobs.total} + ${counts.total}`;
      if (counts.done)
        set.done = sql`${danimeEpisodeImportJobs.done} + ${counts.done}`;
      if (counts.failed)
        set.failed = sql`${danimeEpisodeImportJobs.failed} + ${counts.failed}`;
      if (counts.skipped)
        set.skipped = sql`${danimeEpisodeImportJobs.skipped} + ${counts.skipped}`;
      if (counts.unmatched)
        set.unmatched = sql`${danimeEpisodeImportJobs.unmatched} + ${counts.unmatched}`;
      await db
        .update(danimeEpisodeImportJobs)
        .set(set)
        .where(eq(danimeEpisodeImportJobs.id, jobId));
    },
  };
}

export type EpisodeImportJobRepository = ReturnType<
  typeof episodeImportJobRepository
>;
