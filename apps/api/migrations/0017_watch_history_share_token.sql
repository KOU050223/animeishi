-- 視聴履歴の共有リンク（/share/watch-history/:token, issue #236）のための
-- 推測不能なトークンを users に持たせる。視聴履歴はユーザーごとに 1 つの
-- 共有 URL なので、行ごとの watch_history ではなく users 行に置く。
--
-- NULL は未共有を表す。SQLite の UNIQUE では NULL 同士は区別されるため、
-- 共有していない行が複数あっても一意制約に抵触しない
-- （tier_lists.share_token と同じ方式）。

ALTER TABLE `users` ADD `watch_history_share_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_watch_history_share_token_unique` ON `users` (`watch_history_share_token`);
