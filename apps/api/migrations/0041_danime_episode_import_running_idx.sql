CREATE UNIQUE INDEX `danime_episode_import_jobs_running_idx` ON `danime_episode_import_jobs` (`user_id`) WHERE `status` IN ('matching', 'writing');
