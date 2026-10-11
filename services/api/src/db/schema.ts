import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
} from "drizzle-orm/sqlite-core";

// Annict の StatusState（watch_history.state の許可値）
export const WATCH_STATES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

// ---- users ----
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Clerk user ID (user_xxxxx)
  username: text("username").notNull(),
  bio: text("bio"),
  favoriteQuote: text("favorite_quote"),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
  profileImageUrl: text("profile_image_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- annict_works (Annict 作品キャッシュ) ----
export const annictWorks = sqliteTable("annict_works", {
  annictWorkId: integer("annict_work_id").primaryKey(), // Annict の annictId をそのまま主キー
  // Annict GraphQL の Work Node ID（Base64）。updateStatus(input.workId) が
  // この Node ID を要求するため、read-through 時に取得して保持する。annictId(Int)
  // とは別物。read-through 前に更新が来た作品では未取得（null）で、その場合は
  // 更新時に searchWorks で解決してから埋める。
  nodeId: text("node_id"),
  title: text("title").notNull(),
  titleKana: text("title_kana"),
  titleEn: text("title_en"),
  seasonName: text("season_name"), // 例: "2026-spring"
  seasonYear: integer("season_year"),
  imageUrl: text("image_url"),
  // Annict Work.malAnimeId。外部画像フォールバック（AniList/Jikan）の引き当てキーに使う。
  malAnimeId: integer("mal_anime_id"),
  // 画像フォールバック解決後に埋まる。空なら imageUrl or プレースホルダー、非空なら
  // これを優先して表示する。imageSource でどの供給元か判別できる。
  resolvedImageUrl: text("resolved_image_url"),
  // 'annict' | 'anilist' | 'jikan' | 'none'。'none' は MAL ID が誤り or 供給元にも
  // 画像が無いことが判明したネガキャッシュ。null は未解決（一度も試していない）。
  imageSource: text("image_source"),
  // resolvedImageUrl / imageSource を確定した時刻。TTL 再解決の起点に使う。
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  // 画像フォールバック解決を最後に試行した時刻。cron が未解決作品を直接回す際の
  // クールダウンに使い、429 等で解決できなかった作品の叩き直し頻度を抑える
  // （issue #127）。updateResolvedImage で解決時にクリアし、mal_anime_id 変化時にも
  // リセットする。クールダウン切れ後は再試行対象に戻る。
  imageFallbackAttemptedAt: integer("image_fallback_attempted_at", {
    mode: "timestamp",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- annict_tokens (Web 連携用の暗号化トークン保存) ----
// Web(ブラウザ)連携では SecureStore が無く localStorage は XSS リスクがあるため、
// Annict アクセストークンを AES-GCM で暗号化して D1 に保存し、HttpOnly Cookie の
// セッションから参照する（詳細は docs/05 追補）。ネイティブは従来のヘッダ方式で
// このテーブルは使わない。userId(Clerk) 単位で 1 トークンを持つ。
export const annictTokens = sqliteTable("annict_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // encryptToken() が返す base64(iv||ciphertext)。平文は保存しない。
  encryptedToken: text("encrypted_token").notNull(),
  // Annict 側のトークン所有者 ID（表示・突き合わせ用）。
  annictUserId: integer("annict_user_id"),
  scope: text("scope"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

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

// ---- favorites ----
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("favorites_user_work_unique").on(t.userId, t.annictWorkId),
    index("favorites_user_idx").on(t.userId),
  ],
);

// ---- friends ----
export const friends = sqliteTable(
  "friends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("friends_user_friend_unique").on(t.userId, t.friendId),
    index("friends_user_idx").on(t.userId),
  ],
);

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
    // TierRow[] の JSON 文字列。{ key, label, color } を並び順に持つ。
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/tier-lists/:token）のトークン。null は未共有。
    // 発行は POST /me/tier-lists/:season/share、破棄は DELETE で行う。
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 1 ユーザー 1 シーズンにつき 1 表。作り直しは上書きで済ませる。
    unique("tier_lists_user_season_unique").on(t.userId, t.season),
    index("tier_lists_user_idx").on(t.userId),
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

// ---- user_genres (選択ジャンル) ----
export const userGenres = sqliteTable(
  "user_genres",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    genre: text("genre").notNull(),
  },
  (t) => [
    unique("user_genres_user_genre_unique").on(t.userId, t.genre),
    index("user_genres_user_idx").on(t.userId),
  ],
);

// ---- Type exports ----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AnnictWork = typeof annictWorks.$inferSelect;
export type NewAnnictWork = typeof annictWorks.$inferInsert;
export type WatchHistory = typeof watchHistory.$inferSelect;
export type NewWatchHistory = typeof watchHistory.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Friend = typeof friends.$inferSelect;
export type NewFriend = typeof friends.$inferInsert;
export type UserGenre = typeof userGenres.$inferSelect;
export type TierList = typeof tierLists.$inferSelect;
export type NewTierList = typeof tierLists.$inferInsert;
export type TierListItem = typeof tierListItems.$inferSelect;
export type NewTierListItem = typeof tierListItems.$inferInsert;
export type AnnictToken = typeof annictTokens.$inferSelect;
export type NewAnnictToken = typeof annictTokens.$inferInsert;
