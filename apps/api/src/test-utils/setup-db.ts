import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

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
  `CREATE TABLE IF NOT EXISTS annict_works (
    annict_work_id INTEGER PRIMARY KEY NOT NULL,
    node_id TEXT,
    title TEXT NOT NULL,
    title_kana TEXT,
    title_en TEXT,
    season_name TEXT,
    season_year INTEGER,
    image_url TEXT,
    mal_anime_id INTEGER,
    resolved_image_url TEXT,
    image_source TEXT,
    resolved_at INTEGER,
    image_fallback_attempted_at INTEGER,
    image_r2_key TEXT,
    image_r2_attempted_at INTEGER,
    mal_search_attempted_at INTEGER,
    kitsu_anime_id INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    annict_work_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS watch_history_user_work_unique ON watch_history (user_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS watch_history_user_idx ON watch_history (user_id)`,
  `CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    annict_work_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_work_unique ON favorites (user_id, annict_work_id)`,
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
  `CREATE TABLE IF NOT EXISTS tier_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    season TEXT NOT NULL,
    title TEXT NOT NULL,
    tiers_json TEXT NOT NULL,
    share_token TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tier_lists_user_season_unique ON tier_lists (user_id, season)`,
  `CREATE INDEX IF NOT EXISTS tier_lists_user_idx ON tier_lists (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tier_lists_share_token_unique ON tier_lists (share_token)`,
  `CREATE TABLE IF NOT EXISTS tier_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    tier_list_id INTEGER NOT NULL,
    annict_work_id INTEGER NOT NULL,
    tier_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (tier_list_id) REFERENCES tier_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tier_list_items_list_work_unique ON tier_list_items (tier_list_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS tier_list_items_list_idx ON tier_list_items (tier_list_id)`,
  `CREATE TABLE IF NOT EXISTS annict_characters (
    annict_character_id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_kana TEXT,
    name_en TEXT,
    image_url TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS annict_work_casts (
    annict_work_id INTEGER NOT NULL,
    annict_character_id INTEGER NOT NULL,
    sort_number INTEGER NOT NULL,
    PRIMARY KEY (annict_work_id, annict_character_id),
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE,
    FOREIGN KEY (annict_character_id) REFERENCES annict_characters(annict_character_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS annict_work_casts_work_idx ON annict_work_casts (annict_work_id)`,
  `CREATE TABLE IF NOT EXISTS character_tier_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    annict_work_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    tiers_json TEXT NOT NULL,
    share_token TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS character_tier_lists_user_work_unique ON character_tier_lists (user_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS character_tier_lists_user_idx ON character_tier_lists (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS character_tier_lists_share_token_unique ON character_tier_lists (share_token)`,
  `CREATE TABLE IF NOT EXISTS character_tier_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    character_tier_list_id INTEGER NOT NULL,
    annict_character_id INTEGER NOT NULL,
    tier_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (character_tier_list_id) REFERENCES character_tier_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_character_id) REFERENCES annict_characters(annict_character_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS character_tier_list_items_list_character_unique ON character_tier_list_items (character_tier_list_id, annict_character_id)`,
  `CREATE INDEX IF NOT EXISTS character_tier_list_items_list_idx ON character_tier_list_items (character_tier_list_id)`,
  `CREATE TABLE IF NOT EXISTS annict_tokens (
    user_id TEXT PRIMARY KEY NOT NULL,
    encrypted_token TEXT NOT NULL,
    annict_user_id INTEGER,
    scope TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    reporter_id TEXT NOT NULL,
    reported_user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    resolution_note TEXT,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    CONSTRAINT reports_status_check CHECK (status IN ('open', 'resolved', 'dismissed')),
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_id)`,
  `CREATE INDEX IF NOT EXISTS reports_reported_user_idx ON reports (reported_user_id)`,
  `CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status)`,
  `CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS blocks_blocker_blocked_unique ON blocks (blocker_id, blocked_id)`,
  `CREATE INDEX IF NOT EXISTS blocks_blocker_idx ON blocks (blocker_id)`,
  `CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id)`,
  `CREATE TABLE IF NOT EXISTS analyses (
    user_id TEXT PRIMARY KEY NOT NULL,
    summary TEXT,
    genres_json TEXT,
    input_hash TEXT,
    work_count INTEGER,
    generated_at INTEGER,
    window_started_at INTEGER NOT NULL,
    generation_count INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_users (
    user_id TEXT PRIMARY KEY NOT NULL,
    deleted_at INTEGER NOT NULL
  )`,
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
  await d1.prepare("DELETE FROM deleted_users").run();
  await d1.prepare("DELETE FROM analyses").run();
  await d1.prepare("DELETE FROM reports").run();
  await d1.prepare("DELETE FROM blocks").run();
  await d1.prepare("DELETE FROM annict_tokens").run();
  await d1.prepare("DELETE FROM character_tier_list_items").run();
  await d1.prepare("DELETE FROM character_tier_lists").run();
  await d1.prepare("DELETE FROM tier_list_items").run();
  await d1.prepare("DELETE FROM tier_lists").run();
  await d1.prepare("DELETE FROM user_genres").run();
  await d1.prepare("DELETE FROM friends").run();
  await d1.prepare("DELETE FROM favorites").run();
  await d1.prepare("DELETE FROM watch_history").run();
  await d1.prepare("DELETE FROM users").run();
  await d1.prepare("DELETE FROM annict_work_casts").run();
  await d1.prepare("DELETE FROM annict_characters").run();
  await d1.prepare("DELETE FROM annict_works").run();
  // AUTOINCREMENTカウンターをリセット
  await d1
    .prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('watch_history', 'favorites', 'friends', 'user_genres', 'tier_lists', 'tier_list_items', 'character_tier_lists', 'character_tier_list_items', 'reports', 'blocks')",
    )
    .run();
  return db;
}
