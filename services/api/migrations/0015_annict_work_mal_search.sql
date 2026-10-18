-- MAL ID を持たない作品の AniList タイトル検索（issue #223）
--
-- Annict の malAnimeId が空の作品は、MAL ID をキーにした画像補完
-- （AniList / Jikan）に乗れず画像が欠損していた。cron が AniList の
-- タイトル検索で MAL ID を引き当て、mal_anime_id に書き戻す。
--
--   * mal_search_attempted_at : タイトル検索を最後に試行した時刻。
--                               見つからなかった作品を cron ごとに
--                               検索し直さないためのクールダウン起点。
--
-- 既存行はすべて NULL（未試行）で、次回の cron 実行から順次処理される。

ALTER TABLE `annict_works` ADD COLUMN `mal_search_attempted_at` integer;
