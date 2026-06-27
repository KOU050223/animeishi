-- Annict 連携への設計し直し: anime_titles を廃止し annict_works を導入する
-- watch_history / favorites の FK を annict_works へ張り替える
-- score / comment / watchedAt を廃止し、Annict の StatusState を state カラムに採用する
--
-- ⚠️ 破壊的リセット移行: 旧 anime_titles（しょぼいカレンダー由来）と
-- Annict との作品 ID 対応が存在しないため、旧 favorites / watch_history /
-- anime_titles は変換せず DROP する。既存のお気に入り・視聴履歴は消去される。
-- Annict 連携後にユーザーが再同期する前提の意図的なリセットである。

-- 1. annict_works テーブル追加（Annict 作品キャッシュ・自然キー）
CREATE TABLE `annict_works` (
  `annict_work_id` integer PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `title_kana` text,
  `title_en` text,
  `season_name` text,
  `season_year` integer,
  `image_url` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint

-- 2. watch_history を再作成（FK を annict_works へ張り替え、state カラムへ変更）
DROP TABLE IF EXISTS `watch_history`;
--> statement-breakpoint
CREATE TABLE `watch_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `state` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE,
  CONSTRAINT `watch_history_state_check` CHECK (`state` IN ('WATCHING', 'WATCHED', 'ON_HOLD', 'STOP_WATCHING', 'WANNA_WATCH'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_history_user_work_unique` ON `watch_history` (`user_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `watch_history_user_idx` ON `watch_history` (`user_id`);
--> statement-breakpoint

-- 3. favorites を再作成（FK を annict_works へ張り替え）
DROP TABLE IF EXISTS `favorites`;
--> statement-breakpoint
CREATE TABLE `favorites` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_user_work_unique` ON `favorites` (`user_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `favorites_user_idx` ON `favorites` (`user_id`);
--> statement-breakpoint

-- 4. anime_titles を削除（annict_works へ置換済み）
DROP TABLE IF EXISTS `anime_titles`;
