-- Tier 表の公開設定と説明文（issue #476）
--
-- work_lists（issue #349/#422）と同じく、share_token（URL を知る人だけが
-- 見られる）とは独立した「ひろばの公開一覧に載る」設定（is_public）と、
-- 自由記述の説明文（description）を 3 種類の tier 表に追加する。
-- is_public は #418 の発見画面で公開一覧の対象に使う。既存行はすべて
-- 0（非公開）のままで、公開するには編集画面で明示的に切り替える。

ALTER TABLE `tier_lists` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `tier_lists` ADD COLUMN `is_public` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `tier_lists_public_idx` ON `tier_lists` (`is_public`);
--> statement-breakpoint

ALTER TABLE `character_tier_lists` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `character_tier_lists` ADD COLUMN `is_public` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `character_tier_lists_public_idx` ON `character_tier_lists` (`is_public`);
--> statement-breakpoint

ALTER TABLE `custom_tier_lists` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `custom_tier_lists` ADD COLUMN `is_public` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `custom_tier_lists_public_idx` ON `custom_tier_lists` (`is_public`);
