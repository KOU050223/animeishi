import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";
import { annictCharacters, annictWorks } from "@/features/works/schema.db";

// ---- character_tier_lists (作品単位のキャラクター tier 表) ----
// 作品 tier 表（tier_lists）のキャラクター版。対象の単位が「シーズン」ではなく
// 「作品」になるため annict_work_id をスコープキーに持つ。
export const characterTierLists = sqliteTable(
  "character_tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 対象作品。items のキャラクターはこの作品のキャストから選ばれる前提。
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // 表の説明文。null は未設定（issue #476）。
    description: text("description"),
    tiersJson: text("tiers_json").notNull(),
    shareToken: text("share_token"),
    // ひろばの公開一覧に載るか（issue #476。tier_lists と同じ考え方）。
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 1 ユーザー 1 作品につき 1 表。作り直しは上書きで済ませる。
    unique("character_tier_lists_user_work_unique").on(
      t.userId,
      t.annictWorkId,
    ),
    index("character_tier_lists_user_idx").on(t.userId),
    index("character_tier_lists_public_idx").on(t.isPublic),
    unique("character_tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- character_tier_list_items (キャラクター tier 表に配置されたキャラクター) ----
export const characterTierListItems = sqliteTable(
  "character_tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    characterTierListId: integer("character_tier_list_id")
      .notNull()
      .references(() => characterTierLists.id, { onDelete: "cascade" }),
    annictCharacterId: integer("annict_character_id")
      .notNull()
      .references(() => annictCharacters.annictCharacterId, {
        onDelete: "cascade",
      }),
    tierKey: text("tier_key").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("character_tier_list_items_list_character_unique").on(
      t.characterTierListId,
      t.annictCharacterId,
    ),
    index("character_tier_list_items_list_idx").on(t.characterTierListId),
  ],
);

export type CharacterTierList = typeof characterTierLists.$inferSelect;
export type NewCharacterTierList = typeof characterTierLists.$inferInsert;
export type CharacterTierListItem = typeof characterTierListItems.$inferSelect;
export type NewCharacterTierListItem =
  typeof characterTierListItems.$inferInsert;
