CREATE INDEX `annict_works_pending_mal_idx` ON `annict_works` (`updated_at`) WHERE `mal_anime_id` IS NULL;--> statement-breakpoint
CREATE INDEX `annict_works_pending_image_idx` ON `annict_works` (`updated_at`) WHERE `image_source` IS NULL OR `image_source` = 'none';--> statement-breakpoint
CREATE INDEX `annict_works_pending_genre_idx` ON `annict_works` (`updated_at`) WHERE `genres` IS NULL OR `genres` = '[]';
