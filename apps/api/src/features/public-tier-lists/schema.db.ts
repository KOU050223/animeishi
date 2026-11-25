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

// tier 表の種別（tier_list_likes.list_kind / reports.reported_tier_list_kind の
// 許可値, issue #418）。3 種類の tier 表が別テーブルに分かれるため
// 対象を (kind, id) で指すときに使う。
export const TIER_LIST_KINDS = ["season", "character", "custom"] as const;
export type TierListKind = (typeof TIER_LIST_KINDS)[number];

// ---- tier_list_likes (公開 tier 表へのいいね, issue #418) ----
// 3 種類の tier 表（tier_lists / character_tier_lists / custom_tier_lists）は
// 別テーブルに分かれるため、対象を (list_kind, list_id) で指す。
// (user_id, list_kind, list_id) で 1 件のため、いいね操作は冪等にできる。
// list_id 側の FK は張れない（参照先が kind で変わる）ため、各 tier 表の
// 削除関数が (list_kind, list_id) の一致する行を同じ batch で消す
// （退会は deleteMyAccount が一括削除する）。
export const tierListLikes = sqliteTable(
  "tier_list_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listKind: text("list_kind", { enum: TIER_LIST_KINDS }).notNull(),
    listId: integer("list_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("tier_list_likes_user_list_unique").on(
      t.userId,
      t.listKind,
      t.listId,
    ),
    index("tier_list_likes_list_idx").on(t.listKind, t.listId),
    check(
      "tier_list_likes_list_kind_check",
      sql`${t.listKind} IN ('season', 'character', 'custom')`,
    ),
  ],
);
