-- アプリ内の不具合報告・ご意見（feedbacks）
--
-- ホームのヘッダーとサポートページから開く送信フォームの受け皿。
-- 運営は task feedback:list で読む（Discord には件数だけ通知する）。
-- 不具合の切り分けに使うため、送信時のアプリバージョンとプラットフォームを残す。
-- 退会時は他のユーザーデータと同じく削除する（cascade + deleteAccount）。

CREATE TABLE `feedbacks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `category` text NOT NULL,
  `body` text NOT NULL,
  `app_version` text,
  `platform` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `feedbacks_user_created_idx` ON `feedbacks` (`user_id`, `created_at`);
