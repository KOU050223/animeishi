import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictCharacters, annictWorks } from "@/features/works/schema.db";

// tier 表の種別（tier_lists.kind の許可値）。#724 で 3 系統の tier 表を
// 1 テーブルに統合し、違いは「対象の単位」と「配置するもの」だけにした。
// - season:    シーズン単位。対象は season、配置は作品
// - character: 作品単位。対象は annict_work_id、配置はその作品のキャラクター
// - custom:    対象スコープなし。ユーザーが付けたテーマで作品を自由に配置
export const TIER_LIST_KINDS = ["season", "character", "custom"] as const;
export type TierListKind = (typeof TIER_LIST_KINDS)[number];

// ---- tier_lists (シーズン・キャラクター・自由作成の tier 表, issue #724) ----
// 3 系統の違いは「対象スコープ列」（season / annict_work_id / なし）だけなので
// 1 テーブルに統合し、kind ごとの列の有無は CHECK で担保する。
// tiers（S/A/B... の行定義）は行数・ラベル・色をユーザーが自由に決められるため
// 正規化せず JSON 1 カラムに持つ。行の並び順は配列順そのまま。
export const tierLists = sqliteTable(
  "tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TIER_LIST_KINDS }).notNull(),
    // 対象シーズン。annict_works.seasonName と同じ "2026-spring" 形式。
    // kind='season' の行だけ値を持つ。
    season: text("season"),
    // 対象作品。items のキャラクターはこの作品のキャストから選ばれる前提。
    // kind='character' の行だけ値を持つ。
    annictWorkId: integer("annict_work_id").references(
      () => annictWorks.annictWorkId,
      { onDelete: "cascade" },
    ),
    title: text("title").notNull(),
    // 表の説明文。null は未設定（issue #476）。
    description: text("description"),
    // TierRow[] の JSON 文字列。{ key, label, color } を並び順に持つ。
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/tier-lists/:token）のトークン。null は未共有。
    // 発行は POST /me/tier-lists/:id/share、破棄は DELETE で行う。
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
    // 対象スコープ列と kind の一致を DB でも保証する。ずれた行はアプリ層の
    // 検証漏れなので CHECK で止める（kind 自体は enum の CHECK で担保）。
    check(
      "tier_lists_kind_check",
      sql`${t.kind} IN ('season', 'character', 'custom')`,
    ),
    check(
      "tier_lists_kind_columns_check",
      sql`(${t.kind} = 'season' AND ${t.season} IS NOT NULL AND ${t.annictWorkId} IS NULL)
        OR (${t.kind} = 'character' AND ${t.annictWorkId} IS NOT NULL AND ${t.season} IS NULL)
        OR (${t.kind} = 'custom' AND ${t.season} IS NULL AND ${t.annictWorkId} IS NULL)`,
    ),
    // 1 ユーザー 1 シーズン / 1 作品につき 1 表。作り直しは上書きで済ませる。
    // kind 間で同じ season / annict_work_id を持つ行を許すため部分索引にする
    // （custom 行は対象列が NULL なので、全行索引でも衝突しないが、
    // 「スコープ内での一意性」という意図を索引側に明示する）。
    uniqueIndex("tier_lists_user_season_unique")
      .on(t.userId, t.season)
      .where(sql`${t.kind} = 'season'`),
    uniqueIndex("tier_lists_user_work_unique")
      .on(t.userId, t.annictWorkId)
      .where(sql`${t.kind} = 'character'`),
    index("tier_lists_user_idx").on(t.userId),
    index("tier_lists_public_idx").on(t.isPublic),
    // 共有リンクからの引き当てキー。SQLite では NULL は互いに異なる値として
    // 扱われるため、未共有行が複数あってもユニーク制約に抵触しない。
    unique("tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- tier_list_items (tier 表に配置された作品・キャラクター) ----
// 未配置（どの tier にも入れていない）アイテムはここに行を持たない。
// season/custom は作品（annict_work_id）、character はキャラクター
// （annict_character_id）を指し、どちらか一方だけが非 NULL。
export const tierListItems = sqliteTable(
  "tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tierListId: integer("tier_list_id")
      .notNull()
      .references(() => tierLists.id, { onDelete: "cascade" }),
    // 配置された作品。kind=season / custom の表のアイテム。
    annictWorkId: integer("annict_work_id").references(
      () => annictWorks.annictWorkId,
      { onDelete: "cascade" },
    ),
    // 配置されたキャラクター。kind=character の表のアイテム。
    annictCharacterId: integer("annict_character_id").references(
      () => annictCharacters.annictCharacterId,
      { onDelete: "cascade" },
    ),
    // tiersJson 内の TierRow.key を指す。FK は張れないため整合性はアプリ層で担保する。
    tierKey: text("tier_key").notNull(),
    // 同一 tier 内での左からの並び順。
    position: integer("position").notNull(),
  },
  (t) => [
    // 作品かキャラクターのどちらか一方だけが非 NULL。
    check(
      "tier_list_items_target_check",
      sql`(${t.annictWorkId} IS NOT NULL) <> (${t.annictCharacterId} IS NOT NULL)`,
    ),
    // NULL を含む行はユニーク制約の対象外（SQLite では NULL は互いに
    // 異なる値）。target_check と合わせて、片方の列の行同士だけが比較される。
    unique("tier_list_items_list_work_unique").on(t.tierListId, t.annictWorkId),
    unique("tier_list_items_list_character_unique").on(
      t.tierListId,
      t.annictCharacterId,
    ),
    index("tier_list_items_list_idx").on(t.tierListId),
  ],
);

export type TierList = typeof tierLists.$inferSelect;
