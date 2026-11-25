import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";
import { annictWorks } from "#src/features/works/schema.db";

// ---- custom_tier_lists (テーマ名を付けた自由作成の作品 tier 表) ----
// tier_lists（シーズン版）と違い対象の作品集合をシーズンで縛らない。
// シーズン版は「1 ユーザー 1 シーズン 1 表」の upsert だが、こちらは
// 1 人で複数作れるためスコープキーを持たず、id で識別する。
export const customTierLists = sqliteTable(
  "custom_tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ユーザーが付けるテーマ名（「歴代で好きなアニメ」など）。
    title: text("title").notNull(),
    // 表の説明文。null は未設定（issue #476）。
    description: text("description"),
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/custom-tier-lists/:token）のトークン。null は未共有。
    shareToken: text("share_token"),
    // ひろばの公開一覧に載るか（issue #476。tier_lists と同じ考え方）。
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("custom_tier_lists_user_idx").on(t.userId),
    index("custom_tier_lists_public_idx").on(t.isPublic),
    unique("custom_tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- custom_tier_list_items (自由作成 tier 表に配置された作品) ----
// 未配置（どの tier にも入れていない）作品は行を持たない。シーズン版と
// 違い「候補一覧 - 配置済み」の未分類は存在せず、未配置のままだと消える。
export const customTierListItems = sqliteTable(
  "custom_tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customTierListId: integer("custom_tier_list_id")
      .notNull()
      .references(() => customTierLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    tierKey: text("tier_key").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("custom_tier_list_items_list_work_unique").on(
      t.customTierListId,
      t.annictWorkId,
    ),
    index("custom_tier_list_items_list_idx").on(t.customTierListId),
  ],
);

export type CustomTierList = typeof customTierLists.$inferSelect;
