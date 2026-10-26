-- 作品画像の R2 事前取り込み（issue #174）
--
-- 外部 CDN の画像 URL をそのまま返すと初回表示が外部ホストの応答・キャッシュ
-- 状態に左右されるため、cron が今期・来期作品の画像を R2 に取り込み、
-- GET /images/works/... で自前配信する。
--
--   * image_r2_key          : 取り込んだ R2 オブジェクトキー
--                             （works/<annictWorkId>/<sourceUrlHash>.<ext>）。
--                             取り込み元 URL のハッシュをキーに含めることで、
--                             取り込み元が変わった作品だけ自動で再取り込みされる。
--   * image_r2_attempted_at : 取り込み（または対象判定）を最後に試行した時刻。
--                             失敗・取り込み元なしの作品が cron ごとに
--                             叩き直されるのをクールダウンで抑える。
--
-- 既存行はすべて NULL で、次回の cron 実行から順次埋まる。

ALTER TABLE `annict_works` ADD COLUMN `image_r2_key` text;
ALTER TABLE `annict_works` ADD COLUMN `image_r2_attempted_at` integer;
