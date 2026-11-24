import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictWorks } from "@/features/works/schema.db";

// ---- tier_lists (シーズン単位のアニメ tier 表) ----
// tiers（S/A/B... の行定義）は行数・ラベル・色をユーザーが自由に決められるため
// 正規化せず JSON 1 カラムに持つ。行の並び順は配列順そのもの。
// 別テーブルにすると「行の並べ替え」がそのまま position 更新の一括 UPDATE になり、
// MVP の費用対効果に見合わない。
export const tierLists = sqliteTable(
  "tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 対象シーズン。annict_works.seasonName と同じ "2026-spring" 形式。
    season: text("season").notNull(),
    title: text("title").notNull(),
    // 表の説明文。null は未設定（issue #476）。
    description: text("description"),
    // TierRow[] の JSON 文字列。{ key, label, color } を並び順に持つ。
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/tier-lists/:token）のトークン。null は未共有。
    // 発行は POST /me/tier-lists/:season/share、破棄は DELETE で行う。
    shareToken: text("share_token"),
    // ひろばの公開一覧に載るか（issue #476、発見画面は #418）。
    // share_token とは独立（URL 共有はしたいが一覧には出したくない、を両立）。
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 1 ユーザー 1 シーズンにつき 1 表。作り直しは上書きで済ませる。
    unique("tier_lists_user_season_unique").on(t.userId, t.season),
    index("tier_lists_user_idx").on(t.userId),
    index("tier_lists_public_idx").on(t.isPublic),
    // 共有リンクからの引き当てキー。SQLite では NULL は互いに異なる値として
    // 扱われるため、未共有行が複数あってもユニーク制約に抵触しない。
    unique("tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- tier_list_items (tier 表に配置された作品) ----
// 未配置（どの tier にも入れていない）作品はここに行を持たない。
// 「シーズン全作品 - 配置済み」がクライアント側の未分類トレイになる。
export const tierListItems = sqliteTable(
  "tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tierListId: integer("tier_list_id")
      .notNull()
      .references(() => tierLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    // tiersJson 内の TierRow.key を指す。FK は張れないため整合性はアプリ層で担保する。
    tierKey: text("tier_key").notNull(),
    // 同一 tier 内での左からの並び順。
    position: integer("position").notNull(),
  },
  (t) => [
    unique("tier_list_items_list_work_unique").on(t.tierListId, t.annictWorkId),
    index("tier_list_items_list_idx").on(t.tierListId),
  ],
);

export type TierList = typeof tierLists.$inferSelect;
