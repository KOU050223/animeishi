-- アニメ tier 表機能: シーズン単位で作品をランク付けして保存する
--
-- tiers（S/A/B... の行定義）は行数・ラベル・色をユーザーが自由に決められるため
-- 正規化せず tiers_json に持つ。行の並び順は JSON 配列の順序そのもの。

CREATE TABLE `tier_lists` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `season` text NOT NULL,
  `title` text NOT NULL,
  `tiers_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- 1 ユーザー 1 シーズンにつき 1 表。作り直しは上書きで済ませる。
CREATE UNIQUE INDEX `tier_lists_user_season_unique` ON `tier_lists` (`user_id`, `season`);
--> statement-breakpoint
CREATE INDEX `tier_lists_user_idx` ON `tier_lists` (`user_id`);
--> statement-breakpoint

-- 未配置（どの tier にも入れていない）作品はここに行を持たない。
-- 「シーズン全作品 - 配置済み」がクライアント側の未分類トレイになる。
CREATE TABLE `tier_list_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `tier_list_id` integer NOT NULL,
  `annict_work_id` integer NOT NULL,
  `tier_key` text NOT NULL,
  `position` integer NOT NULL,
  FOREIGN KEY (`tier_list_id`) REFERENCES `tier_lists`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tier_list_items_list_work_unique` ON `tier_list_items` (`tier_list_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `tier_list_items_list_idx` ON `tier_list_items` (`tier_list_id`);
