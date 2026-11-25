import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { tierLists } from "@/features/tier-lists/schema.db";
import { users } from "@/features/users/schema.db";

// ---- tier_list_likes (公開 tier 表へのいいね, issue #418) ----
// (user_id, tier_list_id) で 1 件のため、いいね操作は冪等にできる。
// #724 で 3 系統の tier 表が tier_lists に統合されたため FK を張り、
// 表の削除でいいねも cascade で消える（kind+id の多態参照は廃止）。
export const tierListLikes = sqliteTable(
  "tier_list_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tierListId: integer("tier_list_id")
      .notNull()
      .references(() => tierLists.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("tier_list_likes_user_list_unique").on(t.userId, t.tierListId),
    index("tier_list_likes_list_idx").on(t.tierListId),
  ],
);
