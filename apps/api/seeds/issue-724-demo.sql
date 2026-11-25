-- issue #724 移行検証用のデモデータ（旧スキーマ 0000-0046 の直後に入れる）。
-- tier 表 3 系統・いいね・通報を 1 件以上ずつ入れ、移行後の件数・id 対応を確かめる。
INSERT INTO users (id, username, is_public, created_at, updated_at) VALUES
  ('u1', 'ユーザー1', 1, 1700000000, 1700000000),
  ('u2', 'ユーザー2', 1, 1700000000, 1700000000),
  ('u3', 'ユーザー3', 1, 1700000000, 1700000000);
INSERT INTO annict_works (annict_work_id, title, updated_at) VALUES
  (1001, '作品A', 1700000000), (1002, '作品B', 1700000000), (1003, '作品C', 1700000000);
INSERT INTO annict_characters (annict_character_id, name, updated_at) VALUES
  (501, 'キャラ甲', 1700000000), (502, 'キャラ乙', 1700000000);
INSERT INTO annict_work_casts (annict_work_id, annict_character_id, sort_number) VALUES
  (1001, 501, 1), (1001, 502, 2);
-- シーズン版（id 1, 2）
INSERT INTO tier_lists (id, user_id, season, title, tiers_json, share_token, is_public, created_at, updated_at) VALUES
  (1, 'u1', '2025-autumn', 'u1 の秋', '[{"key":"s","label":"S","color":"#ff0000"},{"key":"a","label":"A","color":"#00ff00"}]', 'tok-s1', 1, 1700000000, 1700000000),
  (2, 'u2', '2025-autumn', 'u2 の秋', '[{"key":"s","label":"S","color":"#ff0000"}]', NULL, 0, 1700000000, 1700000000);
INSERT INTO tier_list_items (tier_list_id, annict_work_id, tier_key, position) VALUES
  (1, 1001, 's', 0), (1, 1002, 'a', 0), (2, 1003, 's', 0);
-- キャラクター版（id 1, 2 → 移行後 3, 4 を想定）
INSERT INTO character_tier_lists (id, user_id, annict_work_id, title, tiers_json, share_token, is_public, created_at, updated_at) VALUES
  (1, 'u1', 1001, '作品A キャラ', '[{"key":"s","label":"S","color":"#ff0000"},{"key":"a","label":"A","color":"#00ff00"}]', NULL, 1, 1700000000, 1700000000),
  (2, 'u2', 1001, 'u2 キャラ', '[{"key":"s","label":"S","color":"#ff0000"}]', 'tok-c2', 1, 1700000000, 1700000000);
INSERT INTO character_tier_list_items (character_tier_list_id, annict_character_id, tier_key, position) VALUES
  (1, 501, 's', 0), (1, 502, 'a', 0), (2, 501, 's', 0);
-- 自由作成版（id 1, 2 → 移行後 5, 6 を想定）
INSERT INTO custom_tier_lists (id, user_id, title, tiers_json, share_token, is_public, created_at, updated_at) VALUES
  (1, 'u1', 'おすすめ', '[{"key":"s","label":"S","color":"#ff0000"}]', NULL, 1, 1700000000, 1700000000),
  (2, 'u2', '歴代', '[{"key":"s","label":"S","color":"#ff0000"},{"key":"a","label":"A","color":"#00ff00"}]', NULL, 1, 1700000000, 1700000000);
INSERT INTO custom_tier_list_items (custom_tier_list_id, annict_work_id, tier_key, position) VALUES
  (1, 1001, 's', 0), (2, 1002, 's', 0), (2, 1003, 'a', 0);
-- いいね（3 kind それぞれ）
INSERT INTO tier_list_likes (user_id, list_kind, list_id, created_at) VALUES
  ('u2', 'season', 1, 1700000000),
  ('u3', 'season', 1, 1700000000),
  ('u1', 'character', 2, 1700000000),
  ('u1', 'custom', 2, 1700000000);
-- 通報（ユーザー通報 1 件 + tier 表 3 kind それぞれ）
INSERT INTO reports (reporter_id, reported_user_id, reason, reported_tier_list_kind, reported_tier_list_id, created_at) VALUES
  ('u3', 'u2', 'ユーザー通報', NULL, NULL, 1700000000),
  ('u1', 'u2', 'キャラ表通報', 'character', 2, 1700000000),
  ('u2', 'u1', '自由表通報', 'custom', 1, 1700000000),
  ('u2', 'u1', 'シーズン表通報', 'season', 1, 1700000000);
