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

/** 対応付けループが順に処理する作品の参照（大きい episodesJson は含めない）。 */
export type DanimeEpisodeJobWorkRef = {
  id: number;
  annictWorkId: number;
};

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
      // D1 は 1 文あたり 100 バインド変数まで。4 変数/行なので
      // 20 行ずつに分けて挿入する（26 行で上限超過になる）。
      for (let i = 0; i < rows.length; i += 20) {
        await db.insert(danimeEpisodeImportWorks).values(rows.slice(i, i + 20));
      }
    },

    /**
     * 対象作品の参照一覧。episodesJson は行ごとに大きくなり得るため
     * ここでは返さず、各対応付けステップが getJobWork で読み直す
     * （Workflow のステップ結果に巨大なペイロードを残さないため）。
     */
    async listJobWorkRefs(jobId: string): Promise<DanimeEpisodeJobWorkRef[]> {
      return db
        .select({
          id: danimeEpisodeImportWorks.id,
          annictWorkId: danimeEpisodeImportWorks.annictWorkId,
        })
        .from(danimeEpisodeImportWorks)
        .where(eq(danimeEpisodeImportWorks.jobId, jobId))
        .orderBy(asc(danimeEpisodeImportWorks.id));
    },

    async getJobWork(id: number): Promise<DanimeEpisodeImportWork | undefined> {
      return db.query.danimeEpisodeImportWorks.findFirst({
        where: eq(danimeEpisodeImportWorks.id, id),
      });
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
      // D1 は 1 文あたり 100 バインド変数まで。6 変数/行なので
      // 15 行ずつに分けて挿入する（17 行で上限超過になる）。
      const now = new Date();
      for (let i = 0; i < rows.length; i += 15) {
        await db
          .insert(danimeEpisodeImportItems)
          .values(rows.slice(i, i + 15).map((r) => ({ ...r, updatedAt: now })));
      }
    },

    /**
     * 指定した Annict 話 ID のうち、既にアイテムとして登録済みのものを返す。
     * 対応付けステップが再実行（ステップリトライや引き継ぎインスタンスの
     * 範囲重複）されても同じ Annict 話を二重に積まないための冪等フィルタ。
     */
    async listItemEpisodeIdsIn(
      jobId: string,
      annictEpisodeIds: number[],
    ): Promise<Set<number>> {
      if (annictEpisodeIds.length === 0) return new Set();
      const rows = await db
        .select({ annictEpisodeId: danimeEpisodeImportItems.annictEpisodeId })
        .from(danimeEpisodeImportItems)
        .where(
          and(
            eq(danimeEpisodeImportItems.jobId, jobId),
            inArray(danimeEpisodeImportItems.annictEpisodeId, annictEpisodeIds),
          ),
        );
      return new Set(rows.map((r) => r.annictEpisodeId));
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

    /**
     * アイテムの終了状態とジョブのカウンタ更新を 1 バッチで書く。
     * 別々に書くと、片方だけコミットした状態でステップが死んだときに
     * リトライでカウンタがずれる（done にしたのにカウントされない、
     * またはその逆）ため、D1 バッチのアトミック性に頼る。
     */
    async finishItem(
      jobId: string,
      itemId: number,
      status: "done" | "failed" | "skipped",
      error?: string,
    ): Promise<void> {
      const now = new Date();
      // skipped は書き込みフェーズで「既に記録済み」と判明したケース。
      // 書き込み予定数（total）から外して skipped 側に回す。
      const counter =
        status === "done"
          ? { done: sql`${danimeEpisodeImportJobs.done} + 1` }
          : status === "failed"
            ? { failed: sql`${danimeEpisodeImportJobs.failed} + 1` }
            : {
                skipped: sql`${danimeEpisodeImportJobs.skipped} + 1`,
                total: sql`MAX(0, ${danimeEpisodeImportJobs.total} - 1)`,
              };
      await db.batch([
        db
          .update(danimeEpisodeImportItems)
          .set({ status, error: error ?? null, updatedAt: now })
          .where(eq(danimeEpisodeImportItems.id, itemId)),
        db
          .update(danimeEpisodeImportJobs)
          .set({ ...counter, updatedAt: now })
          .where(eq(danimeEpisodeImportJobs.id, jobId)),
      ]);
    },

    /**
     * 対応付け完了後にカウンタを再計算して絶対値で書き込む。
     * 加算ではなく派生値の代入なので、ステップのリトライ・インスタンス
     * 引き継ぎを挟んでも結果が変わらない（冪等）。
     * total はこれから書き込む件数（pending）、skipped は Annict に
     * 記録済みで書かない話、unmatched は入力の視聴済み話から
     * アイテム化できなかった話数（json_each で episodesJson を数え直す）。
     */
    async finalizeJobMatchCounts(jobId: string): Promise<void> {
      await db
        .update(danimeEpisodeImportJobs)
        .set({
          total: sql`(SELECT COUNT(*) FROM danime_episode_import_items WHERE job_id = ${jobId} AND status = 'pending')`,
          skipped: sql`(SELECT COUNT(*) FROM danime_episode_import_items WHERE job_id = ${jobId} AND status = 'skipped')`,
          unmatched: sql`MAX(0, (SELECT COUNT(*) FROM danime_episode_import_works w, json_each(w.episodes_json) e WHERE w.job_id = ${jobId} AND json_extract(e.value, '$.watched') = 1) - (SELECT COUNT(*) FROM danime_episode_import_items WHERE job_id = ${jobId}))`,
          updatedAt: new Date(),
        })
        .where(eq(danimeEpisodeImportJobs.id, jobId));
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
  };
}

export type EpisodeImportJobRepository = ReturnType<
  typeof episodeImportJobRepository
>;
