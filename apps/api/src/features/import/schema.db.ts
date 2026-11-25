import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";

// ---- danime_episode_import_jobs (dアニメ話単位の記録ジョブ, issue #477) ----
// レビュー画面の「登録」でジョブを登録して即座に返し、Annict createRecord の
// 大量書き込み（約 1 秒間隔）は Cloudflare Workflows がバックグラウンドで
// 実行する。進捗はこの表に逐次記録し、Workflow の再実行・画面ポーリングは
// ここを参照する。ユーザーは同時に 1 つだけ実行中ジョブを持てる
// （実行中に新規作成されないよう API 側で拒否する）。
export const DANIME_EPISODE_JOB_STATUSES = [
  // Annict 話一覧の取得と対応付け（マッチング）を行っている。
  "matching",
  // 確定した話を Annict に順次書き込んでいる。
  "writing",
  "completed",
  "failed",
] as const;
export type DanimeEpisodeJobStatus =
  (typeof DANIME_EPISODE_JOB_STATUSES)[number];

export const danimeEpisodeImportJobs = sqliteTable(
  "danime_episode_import_jobs",
  {
    // Workflow インスタンス ID と揃える UUID。
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: DANIME_EPISODE_JOB_STATUSES }).notNull(),
    // 書き込み予定の件数（matching 完了後に確定する）。
    total: integer("total").notNull().default(0),
    done: integer("done").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    // Annict に記録済みで書き込まなかった話数。
    skipped: integer("skipped").notNull().default(0),
    // 対応付けが確定しなかった話数（書き込み対象外の参考値）。
    unmatched: integer("unmatched").notNull().default(0),
    // いまこのジョブを処理している Workflow インスタンスの ID（issue #701）。
    // 引き継ぎインスタンスは job.id とは別の ID で起動されるため、進捗参照・
    // 新規作成時の調停はこの列のインスタンスを見る。NULL は列追加前の
    // ジョブで、従来どおり job.id のインスタンスを見る。
    workflowInstanceId: text("workflow_instance_id"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("danime_episode_import_jobs_user_idx").on(t.userId),
    // 同時に 1 ユーザ 1 実行中ジョブにする部分一意インデックス。
    // POST が同時に来ても INSERT の片方が制約で落ち、ルート側が
    // 先に作られたジョブを返す（二重取り込み防止）。
    uniqueIndex("danime_episode_import_jobs_running_idx")
      .on(t.userId)
      .where(sql`${t.status} IN ('matching', 'writing')`),
    check(
      "danime_episode_import_jobs_status_check",
      sql`${t.status} IN ('matching', 'writing', 'completed', 'failed')`,
    ),
  ],
);

// ジョブの入力（対象作品と dアニメ話一覧）。Workflow はパラメータではなく
// この表から入力を読む（ワークフローのパラメータサイズ上限と、
// 平文トークンを載せない設計の両方のため）。
export const danimeEpisodeImportWorks = sqliteTable(
  "danime_episode_import_works",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => danimeEpisodeImportJobs.id, { onDelete: "cascade" }),
    danimeWorkId: text("danime_work_id").notNull(),
    // 作品照合で exact 確定した Annict 作品 ID（クライアント申告値を
    // API 側で受理するが、話対応付け・記録はこの ID の話一覧と突き合わせる
    // ので任意の話へは書けない）。
    annictWorkId: integer("annict_work_id").notNull(),
    // dアニメ側の話一覧（partId・watched・話数表記・サブタイトル）の JSON。
    episodesJson: text("episodes_json").notNull(),
  },
  (t) => [index("danime_episode_import_works_job_idx").on(t.jobId)],
);

const DANIME_EPISODE_ITEM_STATUSES = [
  "pending",
  "done",
  "failed",
  // Annict に記録済み（突き合わせ時に viewerDidTrack だった話）。
  "skipped",
] as const;
export type DanimeEpisodeItemStatus =
  (typeof DANIME_EPISODE_ITEM_STATUSES)[number];

// 対応付けが確定した話 1 件ごとの書き込み状態。Workflow の再実行は
// pending の行だけを読み直すので、ステップ途中で落ちても重複書き込み
// しない。
export const danimeEpisodeImportItems = sqliteTable(
  "danime_episode_import_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => danimeEpisodeImportJobs.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id").notNull(),
    annictEpisodeId: integer("annict_episode_id").notNull(),
    // createRecord が要求する Annict Episode の Node ID。
    episodeNodeId: text("episode_node_id").notNull(),
    status: text("status", { enum: DANIME_EPISODE_ITEM_STATUSES }).notNull(),
    error: text("error"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("danime_episode_import_items_job_status_idx").on(t.jobId, t.status),
    check(
      "danime_episode_import_items_status_check",
      sql`${t.status} IN ('pending', 'done', 'failed', 'skipped')`,
    ),
  ],
);

export type DanimeEpisodeImportJob =
  typeof danimeEpisodeImportJobs.$inferSelect;
export type DanimeEpisodeImportWork =
  typeof danimeEpisodeImportWorks.$inferSelect;
export type DanimeEpisodeImportItem =
  typeof danimeEpisodeImportItems.$inferSelect;
