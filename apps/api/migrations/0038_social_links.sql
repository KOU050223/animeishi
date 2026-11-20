CREATE TABLE `social_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `visibility` text DEFAULT 'friends' NOT NULL,
  `position` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `social_links_visibility_check` CHECK (`visibility` IN ('public', 'friends', 'private'))
);
--> statement-breakpoint
CREATE INDEX `social_links_user_position_idx` ON `social_links` (`user_id`, `position`);
