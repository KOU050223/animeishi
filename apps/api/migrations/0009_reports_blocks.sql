-- ユーザー通報・ブロック機能（App Store Guideline 1.2 の UGC 対策, issue #135）
--
-- reports: 通報者 / 対象ユーザー / 理由 / 作成日時。運営がモデレーションに使う。
-- blocks:  blocker が blocked を見えなくする。一覧・名刺閲覧・フレンド追加に
--          双方向で効かせるため (blocker_id, blocked_id) 両方向にインデックスを張る。

CREATE TABLE `reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `reporter_id` text NOT NULL,
  `reported_user_id` text NOT NULL,
  `reason` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporter_id`);
--> statement-breakpoint
CREATE INDEX `reports_reported_user_idx` ON `reports` (`reported_user_id`);
--> statement-breakpoint
CREATE TABLE `blocks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `blocker_id` text NOT NULL,
  `blocked_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`blocker_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`blocked_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_blocker_blocked_unique` ON `blocks` (`blocker_id`, `blocked_id`);
--> statement-breakpoint
CREATE INDEX `blocks_blocker_idx` ON `blocks` (`blocker_id`);
--> statement-breakpoint
CREATE INDEX `blocks_blocked_idx` ON `blocks` (`blocked_id`);
