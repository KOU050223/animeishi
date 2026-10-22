-- MAL ID を持たない作品の Kitsu タイトル検索（issue #227）
--
-- AniList は Cloudflare Workers からのリクエストを 403 で拒否するため、
-- タイトル検索の名寄せ先を Kitsu に切り替える。Kitsu のタイトル検索で
-- 一致した作品の mappings に myanimelist/anime があるものは
-- mal_anime_id に書き戻せるが、新作では MAL mapping が無いことが多い。
-- その場合でも画像を出せるよう、Kitsu 側の作品 ID を保持する。
--
--   * kitsu_anime_id : タイトル検索で一致した Kitsu 作品の ID。
--                      画像プロキシが MAL ID の代わりにこの ID から
--                      Kitsu のポスター画像を引いて取り込む。
--                      （posterImage の URL は失効しうるため URL ではなく
--                      作品 ID を保持する）
--
-- 既存行はすべて NULL で、次回の cron 実行から順次埋まる。

ALTER TABLE `annict_works` ADD COLUMN `kitsu_anime_id` integer;
