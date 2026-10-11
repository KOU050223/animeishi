-- tier 表の共有リンク機能: /share/tier-lists/:token で公開参照するための
-- 推測不能なトークンを tier_lists に持たせる。
--
-- NULL は未共有を表す。SQLite の UNIQUE では NULL 同士は区別されるため、
-- 共有していない行が複数あっても一意制約に抵触しない。

ALTER TABLE `tier_lists` ADD `share_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `tier_lists_share_token_unique` ON `tier_lists` (`share_token`);
