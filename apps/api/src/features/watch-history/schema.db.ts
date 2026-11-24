import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// Annict の StatusState（watch_history.state の許可値）
export const WATCH_STATES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

// ---- watch_history (Annict ライブラリのキャッシュ) ----
export const watchHistory = sqliteTable(
  "watch_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    state: text("state", { enum: WATCH_STATES }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("watch_history_user_work_unique").on(t.userId, t.annictWorkId),
    index("watch_history_user_idx").on(t.userId),
    check(
      "watch_history_state_check",
      sql`${t.state} IN ('WATCHING', 'WATCHED', 'ON_HOLD', 'STOP_WATCHING', 'WANNA_WATCH')`,
    ),
  ],
);

export type WatchHistory = typeof watchHistory.$inferSelect;
export type NewWatchHistory = typeof watchHistory.$inferInsert;
