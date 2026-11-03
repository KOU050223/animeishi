-- 視聴済み作品へのワンタップ 3 段階評価（issue #416）。Animeishi 独自の
-- 評価で Annict には書き戻さない。AI 視聴傾向分析・おすすめの入力に使う。
-- rating は bad=イマイチ / good=良い / great=最高。

CREATE TABLE `work_ratings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `rating` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `work_ratings_rating_check` CHECK (`rating` IN ('bad', 'good', 'great')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_ratings_user_work_unique` ON `work_ratings` (`user_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `work_ratings_user_idx` ON `work_ratings` (`user_id`);
