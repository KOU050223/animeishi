-- issue #724: tier 表 3 系統（tier_lists / character_tier_lists /
-- custom_tier_lists）を kind 列つきの tier_lists に統合する。
-- データ移行を伴うため、新テーブルを __new で作り、旧 3 系統から
-- 転記してから旧テーブルを DROP・__new を RENAME する。
--
-- id の対応:
-- - season 版は id を維持（公開リンクや通報の参照が変わらないよう）。
-- - character / custom 版は旧テーブルと id が衝突しうるため採番し直す。
--   オフセットは旧テーブルの最大 id から一意に決まる
--   （転記中の __new_* を読むと行ごとに値がずれうるため使わない）。
--   各種別のオフセットはそれぞれ
--     character: max(tier_lists.id)（旧シーズン版テーブル）
--     custom:    max(tier_lists.id) + max(character_tier_lists.id)
--   で決まる。likes / reports / items 側も同じ式で対応付ける。
--
-- FK の扱い:
-- - __new_* 子テーブル（items / likes / reports）の REFERENCES は
--   まず __new_tier_lists を指す。親の RENAME で SQLite が子の
--   REFERENCES を tier_lists に書き換えるため、この順序なら
--   移行中のどの時点でも FK が整合し、PRAGMA は要らない。
CREATE TABLE `__new_tier_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`season` text,
	`annict_work_id` integer,
	`title` text NOT NULL,
	`description` text,
	`tiers_json` text NOT NULL,
	`share_token` text,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tier_lists_kind_check" CHECK("kind" IN ('season', 'character', 'custom')),
	CONSTRAINT "tier_lists_kind_columns_check" CHECK(("kind" = 'season' AND "season" IS NOT NULL AND "annict_work_id" IS NULL)
        OR ("kind" = 'character' AND "annict_work_id" IS NOT NULL AND "season" IS NULL)
        OR ("kind" = 'custom' AND "season" IS NULL AND "annict_work_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tier_lists`("id", "user_id", "kind", "season", "annict_work_id", "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at") SELECT "id", "user_id", 'season', "season", NULL, "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at" FROM `tier_lists`;--> statement-breakpoint
INSERT INTO `__new_tier_lists`("id", "user_id", "kind", "season", "annict_work_id", "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at") SELECT "id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`), "user_id", 'character', NULL, "annict_work_id", "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at" FROM `character_tier_lists`;--> statement-breakpoint
INSERT INTO `__new_tier_lists`("id", "user_id", "kind", "season", "annict_work_id", "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at") SELECT "id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`) + (SELECT COALESCE(MAX("id"), 0) FROM `character_tier_lists`), "user_id", 'custom', NULL, NULL, "title", "description", "tiers_json", "share_token", "is_public", "created_at", "updated_at" FROM `custom_tier_lists`;--> statement-breakpoint
CREATE TABLE `__new_tier_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tier_list_id` integer NOT NULL,
	`annict_work_id` integer,
	`annict_character_id` integer,
	`tier_key` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`tier_list_id`) REFERENCES `__new_tier_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`annict_character_id`) REFERENCES `annict_characters`(`annict_character_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tier_list_items_target_check" CHECK(("annict_work_id" IS NOT NULL) <> ("annict_character_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tier_list_items`("id", "tier_list_id", "annict_work_id", "annict_character_id", "tier_key", "position") SELECT "id", "tier_list_id", "annict_work_id", NULL, "tier_key", "position" FROM `tier_list_items`;--> statement-breakpoint
INSERT INTO `__new_tier_list_items`("id", "tier_list_id", "annict_work_id", "annict_character_id", "tier_key", "position") SELECT "id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_list_items`), "character_tier_list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`), NULL, "annict_character_id", "tier_key", "position" FROM `character_tier_list_items`;--> statement-breakpoint
INSERT INTO `__new_tier_list_items`("id", "tier_list_id", "annict_work_id", "annict_character_id", "tier_key", "position") SELECT "id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_list_items`) + (SELECT COALESCE(MAX("id"), 0) FROM `character_tier_list_items`), "custom_tier_list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`) + (SELECT COALESCE(MAX("id"), 0) FROM `character_tier_lists`), "annict_work_id", NULL, "tier_key", "position" FROM `custom_tier_list_items`;--> statement-breakpoint
CREATE TABLE `__new_tier_list_likes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`tier_list_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tier_list_id`) REFERENCES `__new_tier_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tier_list_likes`("id", "user_id", "tier_list_id", "created_at") SELECT "id", "user_id",
	CASE "list_kind"
		WHEN 'season' THEN "list_id"
		WHEN 'character' THEN "list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`)
		ELSE "list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`) + (SELECT COALESCE(MAX("id"), 0) FROM `character_tier_lists`)
	END,
	"created_at" FROM `tier_list_likes` WHERE "list_kind" IN ('season', 'character', 'custom');--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_id` text NOT NULL,
	`reported_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`reported_work_list_id` integer,
	`reported_tier_list_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reported_work_list_id`) REFERENCES `work_lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reported_tier_list_id`) REFERENCES `__new_tier_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reports_status_check" CHECK("status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
INSERT INTO `__new_reports`("id", "reporter_id", "reported_user_id", "reason", "reported_work_list_id", "reported_tier_list_id", "status", "resolution_note", "resolved_at", "created_at") SELECT "id", "reporter_id", "reported_user_id", "reason", "reported_work_list_id",
	CASE "reported_tier_list_kind"
		WHEN 'season' THEN "reported_tier_list_id"
		WHEN 'character' THEN "reported_tier_list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`)
		WHEN 'custom' THEN "reported_tier_list_id" + (SELECT COALESCE(MAX("id"), 0) FROM `tier_lists`) + (SELECT COALESCE(MAX("id"), 0) FROM `character_tier_lists`)
		ELSE NULL
	END,
	"status", "resolution_note", "resolved_at", "created_at" FROM `reports`;--> statement-breakpoint
DROP TABLE `tier_list_likes`;--> statement-breakpoint
DROP TABLE `tier_list_items`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
DROP TABLE `tier_lists`;--> statement-breakpoint
DROP TABLE `character_tier_list_items`;--> statement-breakpoint
DROP TABLE `character_tier_lists`;--> statement-breakpoint
DROP TABLE `custom_tier_list_items`;--> statement-breakpoint
DROP TABLE `custom_tier_lists`;--> statement-breakpoint
ALTER TABLE `__new_tier_lists` RENAME TO `tier_lists`;--> statement-breakpoint
ALTER TABLE `__new_tier_list_items` RENAME TO `tier_list_items`;--> statement-breakpoint
ALTER TABLE `__new_tier_list_likes` RENAME TO `tier_list_likes`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
CREATE UNIQUE INDEX `tier_lists_user_season_unique` ON `tier_lists` (`user_id`,`season`) WHERE "tier_lists"."kind" = 'season';--> statement-breakpoint
CREATE UNIQUE INDEX `tier_lists_user_work_unique` ON `tier_lists` (`user_id`,`annict_work_id`) WHERE "tier_lists"."kind" = 'character';--> statement-breakpoint
CREATE INDEX `tier_lists_user_idx` ON `tier_lists` (`user_id`);--> statement-breakpoint
CREATE INDEX `tier_lists_public_idx` ON `tier_lists` (`is_public`);--> statement-breakpoint
CREATE UNIQUE INDEX `tier_lists_share_token_unique` ON `tier_lists` (`share_token`);--> statement-breakpoint
CREATE INDEX `tier_list_items_list_idx` ON `tier_list_items` (`tier_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tier_list_items_list_work_unique` ON `tier_list_items` (`tier_list_id`,`annict_work_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tier_list_items_list_character_unique` ON `tier_list_items` (`tier_list_id`,`annict_character_id`);--> statement-breakpoint
CREATE INDEX `tier_list_likes_list_idx` ON `tier_list_likes` (`tier_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tier_list_likes_user_list_unique` ON `tier_list_likes` (`user_id`,`tier_list_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `reports_reported_user_idx` ON `reports` (`reported_user_id`);--> statement-breakpoint
CREATE INDEX `reports_reported_work_list_idx` ON `reports` (`reported_work_list_id`);--> statement-breakpoint
CREATE INDEX `reports_reported_tier_list_idx` ON `reports` (`reported_tier_list_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);
