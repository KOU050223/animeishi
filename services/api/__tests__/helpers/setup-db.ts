import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    bio TEXT,
    favorite_quote TEXT,
    is_public INTEGER DEFAULT 1 NOT NULL,
    profile_image_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS anime_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    title_reading TEXT,
    title_english TEXT,
    year INTEGER,
    season TEXT,
    genres TEXT,
    thumbnail_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    anime_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    score INTEGER,
    comment TEXT,
    watched_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (anime_id) REFERENCES anime_titles(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS watch_history_user_anime_unique ON watch_history (user_id, anime_id)`,
  `CREATE INDEX IF NOT EXISTS watch_history_user_idx ON watch_history (user_id)`,
  `CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    anime_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (anime_id) REFERENCES anime_titles(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_anime_unique ON favorites (user_id, anime_id)`,
  `CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id)`,
  `CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friends_user_friend_unique ON friends (user_id, friend_id)`,
  `CREATE INDEX IF NOT EXISTS friends_user_idx ON friends (user_id)`,
  `CREATE TABLE IF NOT EXISTS user_genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    genre TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_genres_user_genre_unique ON user_genres (user_id, genre)`,
  `CREATE INDEX IF NOT EXISTS user_genres_user_idx ON user_genres (user_id)`,
];

/**
 * テスト用DBのセットアップ。
 * Miniflare の D1 インスタンスを受け取り、DDL を直接実行してスキーマを作成する。
 * @cloudflare/vitest-pool-workers 環境ではファイルシステムが制限されるため、
 * drizzle migrator の代わりに D1.prepare().run() で各DDLを適用する。
 */
export async function setupTestDb(d1: D1Database) {
  for (const sql of DDL_STATEMENTS) {
    await d1.prepare(sql).run();
  }
  const db = drizzle(d1, { schema });
  // テスト間でデータをリセット（外部キー制約のある順番で削除）
  await d1.prepare("DELETE FROM user_genres").run();
  await d1.prepare("DELETE FROM friends").run();
  await d1.prepare("DELETE FROM favorites").run();
  await d1.prepare("DELETE FROM watch_history").run();
  await d1.prepare("DELETE FROM users").run();
  await d1.prepare("DELETE FROM anime_titles").run();
  // AUTOINCREMENTカウンターをリセット
  await d1.prepare("DELETE FROM sqlite_sequence WHERE name IN ('anime_titles', 'watch_history', 'favorites', 'friends', 'user_genres')").run();
  return db;
}
