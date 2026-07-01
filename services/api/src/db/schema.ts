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
export type AnnictToken = typeof annictTokens.$inferSelect;
export type NewAnnictToken = typeof annictTokens.$inferInsert;
