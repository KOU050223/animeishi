import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

// ---- feedbacks (アプリ内の不具合報告・ご意見) ----
// category の許可値はクライアントの選択肢と揃える（features/feedback/schema.ts）。
export const FEEDBACK_CATEGORIES = ["bug", "request", "other"] as const;

export const feedbacks = sqliteTable(
  "feedbacks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category", { enum: FEEDBACK_CATEGORIES }).notNull(),
    body: text("body").notNull(),
    appVersion: text("app_version"),
    platform: text("platform"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("feedbacks_user_created_idx").on(t.userId, t.createdAt)],
);
