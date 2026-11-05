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
    watch_history_share_token TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_watch_history_share_token_unique ON users (watch_history_share_token)`,
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
    watchers_count INTEGER,
    genres TEXT,
    genres_fetched_at INTEGER,
    genres_attempted_at INTEGER,
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
  `CREATE TABLE IF NOT EXISTS episode_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    annict_work_id INTEGER NOT NULL,
    annict_episode_id INTEGER NOT NULL,
    episode_node_id TEXT,
    annict_record_id INTEGER,
    record_node_id TEXT,
    source TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    CONSTRAINT episode_records_source_check CHECK (source IN ('animeishi', 'annict')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS episode_records_annict_record_unique ON episode_records (annict_record_id)`,
  `CREATE INDEX IF NOT EXISTS episode_records_user_idx ON episode_records (user_id)`,
  `CREATE INDEX IF NOT EXISTS episode_records_user_work_idx ON episode_records (user_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS episode_records_user_episode_idx ON episode_records (user_id, annict_episode_id)`,
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
    source TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friends_user_friend_unique ON friends (user_id, friend_id)`,
  `CREATE INDEX IF NOT EXISTS friends_user_idx ON friends (user_id)`,
  `CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    requester_id TEXT NOT NULL,
    addressee_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_unique ON friend_requests (requester_id, addressee_id)`,
  `CREATE INDEX IF NOT EXISTS friend_requests_addressee_idx ON friend_requests (addressee_id)`,
  `CREATE INDEX IF NOT EXISTS friend_requests_requester_idx ON friend_requests (requester_id)`,
  `CREATE TABLE IF NOT EXISTS work_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    annict_work_id INTEGER NOT NULL,
    rating TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CONSTRAINT work_ratings_rating_check CHECK (rating IN ('bad', 'good', 'great')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_ratings_user_work_unique ON work_ratings (user_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS work_ratings_user_idx ON work_ratings (user_id)`,
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
    description TEXT,
    tiers_json TEXT NOT NULL,
    share_token TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tier_lists_user_season_unique ON tier_lists (user_id, season)`,
  `CREATE INDEX IF NOT EXISTS tier_lists_user_idx ON tier_lists (user_id)`,
  `CREATE INDEX IF NOT EXISTS tier_lists_public_idx ON tier_lists (is_public)`,
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
    description TEXT,
    tiers_json TEXT NOT NULL,
    share_token TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS character_tier_lists_user_work_unique ON character_tier_lists (user_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS character_tier_lists_user_idx ON character_tier_lists (user_id)`,
  `CREATE INDEX IF NOT EXISTS character_tier_lists_public_idx ON character_tier_lists (is_public)`,
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
  `CREATE TABLE IF NOT EXISTS custom_tier_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tiers_json TEXT NOT NULL,
    share_token TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS custom_tier_lists_user_idx ON custom_tier_lists (user_id)`,
  `CREATE INDEX IF NOT EXISTS custom_tier_lists_public_idx ON custom_tier_lists (is_public)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS custom_tier_lists_share_token_unique ON custom_tier_lists (share_token)`,
  `CREATE TABLE IF NOT EXISTS custom_tier_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    custom_tier_list_id INTEGER NOT NULL,
    annict_work_id INTEGER NOT NULL,
    tier_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (custom_tier_list_id) REFERENCES custom_tier_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS custom_tier_list_items_list_work_unique ON custom_tier_list_items (custom_tier_list_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS custom_tier_list_items_list_idx ON custom_tier_list_items (custom_tier_list_id)`,
  `CREATE TABLE IF NOT EXISTS work_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    share_token TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS work_lists_user_idx ON work_lists (user_id)`,
  `CREATE INDEX IF NOT EXISTS work_lists_public_idx ON work_lists (is_public)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_lists_share_token_unique ON work_lists (share_token)`,
  `CREATE TABLE IF NOT EXISTS work_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    work_list_id INTEGER NOT NULL,
    annict_work_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (work_list_id) REFERENCES work_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_list_items_list_work_unique ON work_list_items (work_list_id, annict_work_id)`,
  `CREATE INDEX IF NOT EXISTS work_list_items_list_idx ON work_list_items (work_list_id)`,
  `CREATE TABLE IF NOT EXISTS work_list_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    work_list_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (work_list_id) REFERENCES work_lists(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_list_likes_user_list_unique ON work_list_likes (user_id, work_list_id)`,
  `CREATE INDEX IF NOT EXISTS work_list_likes_list_idx ON work_list_likes (work_list_id)`,
  `CREATE TABLE IF NOT EXISTS tier_list_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    list_kind TEXT NOT NULL,
    list_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    CONSTRAINT tier_list_likes_list_kind_check CHECK (list_kind IN ('season', 'character', 'custom')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tier_list_likes_user_list_unique ON tier_list_likes (user_id, list_kind, list_id)`,
  `CREATE INDEX IF NOT EXISTS tier_list_likes_list_idx ON tier_list_likes (list_kind, list_id)`,
  `CREATE TABLE IF NOT EXISTS user_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    liked_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (liked_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_likes_user_target_unique ON user_likes (user_id, liked_user_id)`,
  `CREATE INDEX IF NOT EXISTS user_likes_target_idx ON user_likes (liked_user_id)`,
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
    reported_work_list_id INTEGER,
    reported_tier_list_kind TEXT,
    reported_tier_list_id INTEGER,
    status TEXT DEFAULT 'open' NOT NULL,
    resolution_note TEXT,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    CONSTRAINT reports_status_check CHECK (status IN ('open', 'resolved', 'dismissed')),
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_work_list_id) REFERENCES work_lists(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_id)`,
  `CREATE INDEX IF NOT EXISTS reports_reported_user_idx ON reports (reported_user_id)`,
  `CREATE INDEX IF NOT EXISTS reports_reported_work_list_idx ON reports (reported_work_list_id)`,
  `CREATE INDEX IF NOT EXISTS reports_reported_tier_list_idx ON reports (reported_tier_list_kind, reported_tier_list_id)`,
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
  `CREATE TABLE IF NOT EXISTS recommendations (
    user_id TEXT PRIMARY KEY NOT NULL,
    works_json TEXT,
    input_hash TEXT,
    generated_at INTEGER,
    window_started_at INTEGER NOT NULL,
    generation_count INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_users (
    user_id TEXT PRIMARY KEY NOT NULL,
    deleted_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    annict_work_id INTEGER,
    meta TEXT,
    created_at INTEGER NOT NULL,
    CONSTRAINT activities_type_check CHECK (type IN ('watch_status', 'favorite_added', 'tier_list_created', 'tier_list_shared')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (annict_work_id) REFERENCES annict_works(annict_work_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS activities_user_idx ON activities (user_id)`,
  `CREATE TABLE IF NOT EXISTS deletion_feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    reasons TEXT NOT NULL,
    free_text TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS articles (
    slug TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    cover_image_url TEXT,
    published_at INTEGER NOT NULL,
    unpublished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at)`,
  `CREATE TABLE IF NOT EXISTS events (
    slug TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    cover_image_url TEXT,
    location TEXT,
    official_url TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    published_at INTEGER NOT NULL,
    unpublished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_published_idx ON events (published_at)`,
  `CREATE TABLE IF NOT EXISTS event_participations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    event_slug TEXT NOT NULL,
    user_id TEXT NOT NULL,
    visibility TEXT DEFAULT 'private' NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (event_slug) REFERENCES events(slug) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS event_participations_event_user_unique ON event_participations (event_slug, user_id)`,
  `CREATE INDEX IF NOT EXISTS event_participations_user_idx ON event_participations (user_id)`,
  `CREATE TABLE IF NOT EXISTS elections (
    slug TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    cover_image_url TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    published_at INTEGER NOT NULL,
    unpublished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS elections_published_idx ON elections (published_at)`,
  `CREATE TABLE IF NOT EXISTS election_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    election_slug TEXT NOT NULL,
    kind TEXT NOT NULL,
    annict_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    image_url TEXT,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CONSTRAINT election_candidates_kind_check CHECK (kind IN ('character', 'work')),
    FOREIGN KEY (election_slug) REFERENCES elections(slug) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS election_candidates_election_kind_annict_unique ON election_candidates (election_slug, kind, annict_id)`,
  `CREATE INDEX IF NOT EXISTS election_candidates_election_idx ON election_candidates (election_slug)`,
  `CREATE TABLE IF NOT EXISTS election_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    election_slug TEXT NOT NULL,
    candidate_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (election_slug) REFERENCES elections(slug) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES election_candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS election_votes_election_user_unique ON election_votes (election_slug, user_id)`,
  `CREATE INDEX IF NOT EXISTS election_votes_candidate_idx ON election_votes (candidate_id)`,
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
  await d1.prepare("DELETE FROM recommendations").run();
  await d1.prepare("DELETE FROM reports").run();
  await d1.prepare("DELETE FROM blocks").run();
  await d1.prepare("DELETE FROM annict_tokens").run();
  await d1.prepare("DELETE FROM tier_list_likes").run();
  await d1.prepare("DELETE FROM user_likes").run();
  await d1.prepare("DELETE FROM character_tier_list_items").run();
  await d1.prepare("DELETE FROM character_tier_lists").run();
  await d1.prepare("DELETE FROM work_list_items").run();
  await d1.prepare("DELETE FROM work_list_likes").run();
  await d1.prepare("DELETE FROM work_lists").run();
  await d1.prepare("DELETE FROM custom_tier_list_items").run();
  await d1.prepare("DELETE FROM custom_tier_lists").run();
  await d1.prepare("DELETE FROM tier_list_items").run();
  await d1.prepare("DELETE FROM tier_lists").run();
  await d1.prepare("DELETE FROM activities").run();
  await d1.prepare("DELETE FROM user_genres").run();
  await d1.prepare("DELETE FROM friend_requests").run();
  await d1.prepare("DELETE FROM friends").run();
  await d1.prepare("DELETE FROM favorites").run();
  await d1.prepare("DELETE FROM work_ratings").run();
  await d1.prepare("DELETE FROM watch_history").run();
  await d1.prepare("DELETE FROM episode_records").run();
  await d1.prepare("DELETE FROM deletion_feedbacks").run();
  await d1.prepare("DELETE FROM election_votes").run();
  await d1.prepare("DELETE FROM election_candidates").run();
  await d1.prepare("DELETE FROM elections").run();
  await d1.prepare("DELETE FROM event_participations").run();
  await d1.prepare("DELETE FROM events").run();
  await d1.prepare("DELETE FROM articles").run();
  await d1.prepare("DELETE FROM users").run();
  await d1.prepare("DELETE FROM annict_work_casts").run();
  await d1.prepare("DELETE FROM annict_characters").run();
  await d1.prepare("DELETE FROM annict_works").run();
  // AUTOINCREMENTカウンターをリセット
  await d1
    .prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('watch_history', 'episode_records', 'favorites', 'work_ratings', 'friends', 'friend_requests', 'user_genres', 'tier_lists', 'tier_list_items', 'character_tier_lists', 'character_tier_list_items', 'custom_tier_lists', 'custom_tier_list_items', 'work_lists', 'work_list_items', 'work_list_likes', 'reports', 'blocks', 'activities', 'deletion_feedbacks', 'event_participations', 'election_candidates', 'election_votes')",
    )
    .run();
  return db;
}
