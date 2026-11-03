-- 話数単位の視聴記録ログ（issue #439）。1 行 = Annict の 1 record で、
-- 「記録した」イベントを user・作品・話・記録日時・source 付きで残す。
-- #415 の実績バッジ（今期完走・週単位の連続記録）の判定に使う。

CREATE TABLE `episode_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `annict_episode_id` integer NOT NULL,
  `episode_node_id` text,
  `annict_record_id` integer,
  `record_node_id` text,
  `source` text NOT NULL,
  `recorded_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `episode_records_source_check` CHECK (`source` IN ('animeishi', 'annict')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Record.annictId は Annict 全体で一意。viewer.records 同期の dedup キー。
-- SQLite の UNIQUE では NULL 同士が区別されるため、ID を取れなかった
-- （createRecord が record を返さなかった）行が複数あっても抵触しない。
CREATE UNIQUE INDEX `episode_records_annict_record_unique` ON `episode_records` (`annict_record_id`);
--> statement-breakpoint
CREATE INDEX `episode_records_user_idx` ON `episode_records` (`user_id`);
--> statement-breakpoint
CREATE INDEX `episode_records_user_work_idx` ON `episode_records` (`user_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `episode_records_user_episode_idx` ON `episode_records` (`user_id`, `annict_episode_id`);
