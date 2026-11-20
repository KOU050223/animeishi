CREATE TABLE `danime_episode_import_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `status` text NOT NULL,
  `total` integer DEFAULT 0 NOT NULL,
  `done` integer DEFAULT 0 NOT NULL,
  `failed` integer DEFAULT 0 NOT NULL,
  `skipped` integer DEFAULT 0 NOT NULL,
  `unmatched` integer DEFAULT 0 NOT NULL,
  `error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `danime_episode_import_jobs_status_check` CHECK (`status` IN ('matching', 'writing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `danime_episode_import_works` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL,
  `danime_work_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `episodes_json` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `danime_episode_import_jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `danime_episode_import_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `annict_episode_id` integer NOT NULL,
  `episode_node_id` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `danime_episode_import_jobs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `danime_episode_import_items_status_check` CHECK (`status` IN ('pending', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `danime_episode_import_jobs_user_idx` ON `danime_episode_import_jobs` (`user_id`);
--> statement-breakpoint
CREATE INDEX `danime_episode_import_works_job_idx` ON `danime_episode_import_works` (`job_id`);
--> statement-breakpoint
CREATE INDEX `danime_episode_import_items_job_status_idx` ON `danime_episode_import_items` (`job_id`, `status`);
