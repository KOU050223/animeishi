-- フレンドの活動フィード（issue #265）
--
-- activities: ユーザーの「活動」（視聴ステータス更新・推し追加・tier 表の
-- 作成/共有）を記録する。GET /me/feed がフレンドの活動を新しい順に返す。
-- type ごとの補足情報は meta に JSON で持つ
-- （watch_status: {state}、tier_list_*: {kind, season?, title}）。

CREATE TABLE `activities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `type` text NOT NULL,
  `annict_work_id` integer,
  `meta` text,
  `created_at` integer NOT NULL,
  CONSTRAINT activities_type_check CHECK (type IN ('watch_status', 'favorite_added', 'tier_list_created', 'tier_list_shared')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `activities_user_idx` ON `activities` (`user_id`);
