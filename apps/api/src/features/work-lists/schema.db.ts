import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// ---- work_lists (タイトル・説明付きのオリジナル作品リスト) ----
// favorites（推し）とは別機能で、1 人 1 一覧の favorites と違い
// テーマ別に複数作れるためスコープキーを持たず id で識別する
// （custom_tier_lists と同じ判断）。
export const workLists = sqliteTable(
  "work_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // リストの説明文。null は未設定。
    description: text("description"),
    // 共有 URL（/share/work-lists/:token）のトークン。null は未共有。
    shareToken: text("share_token"),
    // ひろばの公開一覧（GET /work-lists/public, issue #422）に載るか。
    // share_token とは独立（URL 共有はしたいが一覧には出したくない、を両立）。
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("work_lists_user_idx").on(t.userId),
    index("work_lists_public_idx").on(t.isPublic),
    unique("work_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- work_list_items (作品リスト内の作品) ----
// tier 配置は持たず、並び順は position だけを持つ。
export const workListItems = sqliteTable(
  "work_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workListId: integer("work_list_id")
      .notNull()
      .references(() => workLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("work_list_items_list_work_unique").on(t.workListId, t.annictWorkId),
    index("work_list_items_list_idx").on(t.workListId),
  ],
);

// ---- work_list_likes (公開作品リストへのいいね, issue #422) ----
// (user_id, work_list_id) で 1 件のため、いいね操作は冪等にできる。
// リスト削除・ユーザー削除で cascade。
export const workListLikes = sqliteTable(
  "work_list_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workListId: integer("work_list_id")
      .notNull()
      .references(() => workLists.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("work_list_likes_user_list_unique").on(t.userId, t.workListId),
    index("work_list_likes_list_idx").on(t.workListId),
  ],
);

export type WorkList = typeof workLists.$inferSelect;
