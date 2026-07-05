-- Annict image は本体で表示されていても API 応答では null / SNS placeholder に
-- 落ちる作品がある。MAL ID 経由で AniList / Jikan から補完するために、以下を追加する。
-- 詳細は issue #86。
--
--   * mal_anime_id       : Annict Work.malAnimeId。外部画像フォールバックの引き当てキー。
--   * resolved_image_url : フォールバック解決後の画像 URL。優先して表示に使う。
--   * image_source       : 'annict' | 'anilist' | 'jikan' | 'none'。'none' はネガキャッシュ。
--                          NULL は「未解決（一度も試していない）」を表す。
--   * resolved_at        : resolved_image_url / image_source を確定した時刻（TTL 起点）。
--
-- 既存行はすべて NULL で、次回 read-through / 検索時に順次埋まる。

ALTER TABLE `annict_works` ADD COLUMN `mal_anime_id` integer;
ALTER TABLE `annict_works` ADD COLUMN `resolved_image_url` text;
ALTER TABLE `annict_works` ADD COLUMN `image_source` text;
ALTER TABLE `annict_works` ADD COLUMN `resolved_at` integer;
