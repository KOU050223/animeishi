-- 公開作品リストの一覧・いいね（issue #422）
--
-- work_lists.is_public: share_token（URL を知る人だけが見られる）とは
-- 独立した「ひろばの公開一覧に載る」設定。既存行はすべて 0（非公開）の
-- ままで、公開するには編集画面で明示的に切り替える。
--
-- work_list_likes: 公開リストへのいいね。(user_id, work_list_id) で
-- 1 件のためいいね操作は冪等。リスト削除・ユーザー削除で cascade。
--
-- reports.reported_work_list_id: 通報の対象に作品リストを加えるための
-- 参照列（issue #186 の拡張）。リスト通報では reported_user_id に
-- リストの所有者、reported_work_list_id にリスト id を入れる。
-- NULL 許可の列追加で既存行・CHECK 制約には触れない。
-- 対象リストが削除されても通報記録は残す（ON DELETE SET NULL。
-- 所有者は reported_user_id で辿れる）。

ALTER TABLE `work_lists` ADD COLUMN `is_public` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `work_lists_public_idx` ON `work_lists` (`is_public`);
--> statement-breakpoint

CREATE TABLE `work_list_likes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `work_list_id` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`work_list_id`) REFERENCES `work_lists`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_list_likes_user_list_unique` ON `work_list_likes` (`user_id`, `work_list_id`);
--> statement-breakpoint
CREATE INDEX `work_list_likes_list_idx` ON `work_list_likes` (`work_list_id`);
--> statement-breakpoint

ALTER TABLE `reports` ADD COLUMN `reported_work_list_id` integer REFERENCES `work_lists`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `reports_reported_work_list_idx` ON `reports` (`reported_work_list_id`);
