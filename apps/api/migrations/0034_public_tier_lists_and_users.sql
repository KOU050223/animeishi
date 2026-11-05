-- 公開 Tier 表・名刺の発見画面（issue #418）
--
-- work_lists（issue #422）と同じ形で、ひろば「みつける」に載る
-- Tier 表（シーズン・キャラクター・自由作成の 3 種）と名刺に
-- いいね・通報を付ける。
--
-- tier_list_likes: 公開 Tier 表へのいいね。3 種類の tier 表は
-- 別テーブルに分かれているため、(list_kind, list_id) で対象を指す。
-- (user_id, list_kind, list_id) で 1 件のためいいね操作は冪等。
-- 対象テーブルが 3 つに分かれるため list_id 側の FK は張らない
-- （リスト削除で like 行は残るが、一覧は必ず実在するリストと
-- JOIN するため表面上は影響しない。いいねした側のユーザー削除は
-- user_id の FK cascade で消える）。
--
-- user_likes: 名刺（公開プロフィール）へのいいね。
-- (user_id, liked_user_id) で 1 件。どちら側の削除でも cascade。
--
-- reports.reported_tier_list_kind / reported_tier_list_id: 通報対象に
-- Tier 表を加えるための参照列（issue #186 の拡張。work_list_likes と
-- 同じく reported_user_id にリスト所有者を入れる）。対象テーブルが
-- 3 つに分かれるため FK は張らず、リストが消えても通報行は残す
-- （所有者は reported_user_id で辿れる。reported_work_list_id の
-- SET NULL と同じ考え方）。

CREATE TABLE `tier_list_likes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `list_kind` text NOT NULL,
  `list_id` integer NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `tier_list_likes_list_kind_check` CHECK (`list_kind` IN ('season', 'character', 'custom')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tier_list_likes_user_list_unique` ON `tier_list_likes` (`user_id`, `list_kind`, `list_id`);
--> statement-breakpoint
CREATE INDEX `tier_list_likes_list_idx` ON `tier_list_likes` (`list_kind`, `list_id`);
--> statement-breakpoint

CREATE TABLE `user_likes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `liked_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`liked_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_likes_user_target_unique` ON `user_likes` (`user_id`, `liked_user_id`);
--> statement-breakpoint
CREATE INDEX `user_likes_target_idx` ON `user_likes` (`liked_user_id`);
--> statement-breakpoint

ALTER TABLE `reports` ADD COLUMN `reported_tier_list_kind` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD COLUMN `reported_tier_list_id` integer;
--> statement-breakpoint
CREATE INDEX `reports_reported_tier_list_idx` ON `reports` (`reported_tier_list_kind`, `reported_tier_list_id`);
