ALTER TABLE `anime_titles` ADD `source_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `anime_titles_source_id_unique` ON `anime_titles` (`source_id`);
