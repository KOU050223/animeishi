-- ジャンル・タグ絞り込み（issue #346）に使うジャンル情報を annict_works に保持する。
--
-- Annict の searchWorks にはジャンルが無いため、mal_anime_id → Kitsu の
-- mappings で作品を名寄せし、Kitsu の categories（ジャンルとタグが混在する
-- 分類）を取り込む。Kitsu に対応が無い作品は MAL API（genres + themes）で
-- 補う。取り込みは画像フォールバックと同じく cron が未解決行を直接回す。
--
--   * genres              : ジャンル・タグ名の配列を JSON 文字列で保持
--                           （例: '["Action","Drama"]'）。null は未取得。
--                           空配列は「取得済みだが供給元にも無い」確定値で、
--                           長めの TTL で再取得される（後から Kitsu に
--                           カテゴリが登録される作品を救う）。
--   * genres_fetched_at   : ジャンル取得に最後に成功した時刻。
--                           空配列確定値の再取得 TTL の起点に使う。
--   * genres_attempted_at : ジャンル取得を最後に試行した時刻。
--                           取得失敗の作品を cron ごとに叩き直さないための
--                           クールダウン起点。成功時刻と分けるのは、空配列の
--                           TTL 再取得が失敗しても「成功時刻」が書き換わって
--                           30 日先まで再試行されなくなるのを防ぐため。
--
-- 既存行はすべて NULL（未試行）で、次回の cron 実行から順次処理される。

ALTER TABLE `annict_works` ADD COLUMN `genres` text;
ALTER TABLE `annict_works` ADD COLUMN `genres_fetched_at` integer;
ALTER TABLE `annict_works` ADD COLUMN `genres_attempted_at` integer;
