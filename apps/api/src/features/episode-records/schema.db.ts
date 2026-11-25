import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";
import { annictWorks } from "#src/features/works/schema.db";

// ---- episode_records (話数単位の視聴記録ログ, issue #439) ----
// 「記録した」イベントのログ。1 行 = Annict の 1 record（再視聴で同じ話に
// 複数 record が付く場合は複数行）。#415 の実績バッジ（今期完走・週単位の
// 連続記録）がこのテーブルだけで判定できる形にする。
const EPISODE_RECORD_SOURCES = ["animeishi", "annict"] as const;

export const episodeRecords = sqliteTable(
  "episode_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    // Annict Episode.annictId。GET /works/:id/episodes が返す話と対応する。
    annictEpisodeId: integer("annict_episode_id").notNull(),
    // Annict Episode の Node ID。同一話の再記録で Node ID を引き直さないよう保持する。
    episodeNodeId: text("episode_node_id"),
    // Annict Record.annictId。Annict 側の記録と対応付く一意キーで、
    // viewer.records 同期の dedup に使う。createRecord が record を
    // 返さなかった行だけ null になる。
    annictRecordId: integer("annict_record_id"),
    // Annict Record の Node ID。deleteRecord が要求するため保持する。
    recordNodeId: text("record_node_id"),
    source: text("source", { enum: EPISODE_RECORD_SOURCES }).notNull(),
    // Annict Record.createdAt（記録が行われた日時）。週単位の連続記録判定
    // （#415）が使うイベント時刻なので、D1 への書き込み時刻とは分けて持つ。
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // Record.annictId は Annict 全体で一意。SQLite の UNIQUE では NULL 同士が
    // 区別されるため、ID を取れなかった行が複数あっても抵触しない。
    unique("episode_records_annict_record_unique").on(t.annictRecordId),
    index("episode_records_user_idx").on(t.userId),
    index("episode_records_user_work_idx").on(t.userId, t.annictWorkId),
    index("episode_records_user_episode_idx").on(t.userId, t.annictEpisodeId),
    check(
      "episode_records_source_check",
      sql`${t.source} IN ('animeishi', 'annict')`,
    ),
  ],
);

export type EpisodeRecord = typeof episodeRecords.$inferSelect;
export type NewEpisodeRecord = typeof episodeRecords.$inferInsert;
