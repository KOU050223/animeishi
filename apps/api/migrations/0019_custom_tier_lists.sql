-- 自由作成 tier 表（issue #348）: テーマ名を付けてシーズンをまたいだ作品で
-- ランク付けする
--
-- tier_lists（シーズン版）と並列な構造だが、対象の作品集合をシーズンで
-- 縛らず 1 人で複数作れるため、user_id + season のスコープキーではなく
-- id で識別する別テーブルにする（character_tier_lists と同じ判断）。

CREATE TABLE `custom_tier_lists` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL,
  `tiers_json` text NOT NULL,
  `share_token` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `custom_tier_lists_user_idx` ON `custom_tier_lists` (`user_id`);
--> statement-breakpoint
-- NULL は未共有を表す。SQLite の UNIQUE では NULL 同士は区別されるため、
-- 共有していない行が複数あっても一意制約に抵触しない。
CREATE UNIQUE INDEX `custom_tier_lists_share_token_unique` ON `custom_tier_lists` (`share_token`);
--> statement-breakpoint

-- 未配置（どの tier にも入れていない）作品はここに行を持たない。
CREATE TABLE `custom_tier_list_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `custom_tier_list_id` integer NOT NULL,
  `annict_work_id` integer NOT NULL,
  `tier_key` text NOT NULL,
  `position` integer NOT NULL,
  FOREIGN KEY (`custom_tier_list_id`) REFERENCES `custom_tier_lists`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_tier_list_items_list_work_unique` ON `custom_tier_list_items` (`custom_tier_list_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `custom_tier_list_items_list_idx` ON `custom_tier_list_items` (`custom_tier_list_id`);
