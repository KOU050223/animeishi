import { integer, sqliteTable, text, index, unique, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

// ---- anime_titles (master) ----
export const animeTitles = sqliteTable("anime_titles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  titleReading: text("title_reading"), // よみがな
  titleEnglish: text("title_english"),
  year: integer("year"),
  season: text("season"), // spring/summer/fall/winter
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- watch_history ----
export const watchHistory = sqliteTable(
  "watch_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => animeTitles.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["watching", "completed", "on_hold", "dropped", "plan_to_watch"],
    }).notNull(),
    score: integer("score"), // 1-10
    comment: text("comment"),
    watchedAt: integer("watched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("watch_history_user_anime_unique").on(t.userId, t.animeId),
    index("watch_history_user_idx").on(t.userId),
    check("watch_history_score_range", sql`${t.score} IS NULL OR ${t.score} BETWEEN 1 AND 10`),
  ]
);

// ---- favorites ----
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => animeTitles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("favorites_user_anime_unique").on(t.userId, t.animeId),
    index("favorites_user_idx").on(t.userId),
  ]
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
  ]
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
  ]
);

// ---- Type exports ----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AnimeTitle = typeof animeTitles.$inferSelect;
export type NewAnimeTitle = typeof animeTitles.$inferInsert;
export type WatchHistory = typeof watchHistory.$inferSelect;
export type NewWatchHistory = typeof watchHistory.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Friend = typeof friends.$inferSelect;
export type NewFriend = typeof friends.$inferInsert;
export type UserGenre = typeof userGenres.$inferSelect;
