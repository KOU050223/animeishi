-- オリジナル作品リスト（issue #349）: タイトル・説明付きのテーマ別
-- 作品リストを 1 人で複数作り、共有トークン URL で公開する
--
-- custom_tier_lists（issue #348）と並列な構造だが、tier 配置を持たず
-- 作品の並び順（position）だけを持つ。推し（favorites）とは別機能で、
-- 1 人 1 一覧の favorites と違い複数作れるため id で識別する。

CREATE TABLE `work_lists` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `share_token` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `work_lists_user_idx` ON `work_lists` (`user_id`);
--> statement-breakpoint
-- NULL は未共有を表す。SQLite の UNIQUE では NULL 同士は区別されるため、
-- 共有していない行が複数あっても一意制約に抵触しない。
CREATE UNIQUE INDEX `work_lists_share_token_unique` ON `work_lists` (`share_token`);
--> statement-breakpoint

-- リスト内の作品。並び順は position で持ち、同一作品の重複登録は許さない。
CREATE TABLE `work_list_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `work_list_id` integer NOT NULL,
  `annict_work_id` integer NOT NULL,
  `position` integer NOT NULL,
  FOREIGN KEY (`work_list_id`) REFERENCES `work_lists`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_list_items_list_work_unique` ON `work_list_items` (`work_list_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `work_list_items_list_idx` ON `work_list_items` (`work_list_id`);
