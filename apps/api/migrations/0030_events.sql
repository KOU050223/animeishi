-- イベント機能 フェーズ 1（issue #411）。運営が登録する大型イベント
-- （AnimeJapan・コミケ等）と、ユーザーごとの「参加する」表明を保持する。
--
-- events: 投入は scripts/publish-event.mjs（frontmatter 付き Markdown を
-- slug で upsert、#437 の記事と同じ仕組み）が担い、API 経路では書き込まない。
-- starts_at 〜 ends_at が会期（名刺交換のまとめ対象期間・両端を含む）、
-- published_at 〜 unpublished_at がアプリへの公開期間（unpublished_at が
-- NULL なら公開終了期限なし）で、articles と同じ公開ウィンドウの考え方。
-- イベントを非公開にしたいときは unpublished_at を過去日時にして再投入する。
--
-- event_participations: 行が存在する = そのユーザーが「参加する」と表明
-- している。フェーズ 1 では本人以外には一切公開しない（フレンドにも
-- 出さない。公開フラグを持たない）。
CREATE TABLE `events` (
  `slug` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `body` text,
  `cover_image_url` text,
  `location` text,
  `official_url` text,
  `starts_at` integer NOT NULL,
  `ends_at` integer NOT NULL,
  `published_at` integer NOT NULL,
  `unpublished_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_published_idx` ON `events` (`published_at`);
--> statement-breakpoint
CREATE TABLE `event_participations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_slug` text NOT NULL,
  `user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`event_slug`) REFERENCES `events`(`slug`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_participations_event_user_unique` ON `event_participations` (`event_slug`, `user_id`);
--> statement-breakpoint
CREATE INDEX `event_participations_user_idx` ON `event_participations` (`user_id`);
