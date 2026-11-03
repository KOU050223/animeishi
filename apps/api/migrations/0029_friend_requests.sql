-- フレンド申請（issue #417）。共有 URL・ユーザー検索からの追加は
-- 申請→承認にするため、承認待ちの申請を保持する。行が存在する = 申請中。
-- 承認時に friends へ双方向登録し申請行を削除、拒否・取消は申請行の削除。
-- 対面 QR 経由の即時成立は従来どおり friends への直接登録で、このテーブルは
-- 通さない（QR 成立時は間にある申請行を掃除する）。
-- friends テーブルの既存行は成立済みとして扱い、既存データは変更しない。

CREATE TABLE `friend_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `requester_id` text NOT NULL,
  `addressee_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`addressee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_requests_pair_unique` ON `friend_requests` (`requester_id`, `addressee_id`);
--> statement-breakpoint
CREATE INDEX `friend_requests_addressee_idx` ON `friend_requests` (`addressee_id`);
--> statement-breakpoint
CREATE INDEX `friend_requests_requester_idx` ON `friend_requests` (`requester_id`);
