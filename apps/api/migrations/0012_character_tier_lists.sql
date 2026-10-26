-- キャラクター tier 表機能（issue #169）: 作品単位でキャラクターをランク付けする
--
-- tier_lists / tier_list_items と並列な構造だが、対象の単位が「シーズン」ではなく
-- 「作品」になるため別テーブルにする（FK を annict_characters に張り、
-- 作品表との行種混在を避けるため）。

-- Annict キャラクターの共有カタログ。Annict GraphQL の Character 型は画像
-- フィールドを持たないため、image_url は AniList からの名寄せ結果を保持する
-- （見つからなければ NULL のまま＝未解決）。read-through で upsert する。
CREATE TABLE `annict_characters` (
  `annict_character_id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_kana` text,
  `name_en` text,
  `image_url` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint

-- 作品→キャラクターの所属カタログ。/works/:id/characters が Annict
-- Work.casts から読み取った所属を保持し、character_tier_lists 保存時に
-- 「その作品のキャストか」を検証する（annict_characters は作品を跨いだ
-- 共有カタログのため、ここが無いと別作品のキャラクターを混入できる）。
CREATE TABLE `annict_work_casts` (
  `annict_work_id` integer NOT NULL,
  `annict_character_id` integer NOT NULL,
  `sort_number` integer NOT NULL,
  PRIMARY KEY (`annict_work_id`, `annict_character_id`),
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_character_id`) REFERENCES `annict_characters`(`annict_character_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `annict_work_casts_work_idx` ON `annict_work_casts` (`annict_work_id`);
--> statement-breakpoint

-- 1 ユーザー 1 作品につき 1 表。作り直しは上書きで済ませる。
CREATE TABLE `character_tier_lists` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `annict_work_id` integer NOT NULL,
  `title` text NOT NULL,
  `tiers_json` text NOT NULL,
  `share_token` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_work_id`) REFERENCES `annict_works`(`annict_work_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_tier_lists_user_work_unique` ON `character_tier_lists` (`user_id`, `annict_work_id`);
--> statement-breakpoint
CREATE INDEX `character_tier_lists_user_idx` ON `character_tier_lists` (`user_id`);
--> statement-breakpoint
-- NULL は未共有を表す。SQLite の UNIQUE では NULL 同士は区別されるため、
-- 共有していない行が複数あっても一意制約に抵触しない。
CREATE UNIQUE INDEX `character_tier_lists_share_token_unique` ON `character_tier_lists` (`share_token`);
--> statement-breakpoint

-- 未配置（どの tier にも入れていない）キャラクターはここに行を持たない。
CREATE TABLE `character_tier_list_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `character_tier_list_id` integer NOT NULL,
  `annict_character_id` integer NOT NULL,
  `tier_key` text NOT NULL,
  `position` integer NOT NULL,
  FOREIGN KEY (`character_tier_list_id`) REFERENCES `character_tier_lists`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`annict_character_id`) REFERENCES `annict_characters`(`annict_character_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_tier_list_items_list_character_unique` ON `character_tier_list_items` (`character_tier_list_id`, `annict_character_id`);
--> statement-breakpoint
CREATE INDEX `character_tier_list_items_list_idx` ON `character_tier_list_items` (`character_tier_list_id`);
