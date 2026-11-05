-- 期間限定の投票型「総選挙」（issue #438）。運営が登録するお題と候補、
-- ユーザーごとの 1 票を保持する。
--
-- elections: 投入は scripts/publish-election.mjs（frontmatter 付き Markdown を
-- slug で upsert、#437 の記事・#411 のイベントと同じ仕組み）が担い、
-- API 経路では書き込まない。starts_at 〜 ends_at が投票期間（両端を含む）、
-- published_at 〜 unpublished_at がアプリへの公開期間（unpublished_at が
-- NULL なら公開終了期限なし）で、events と同じ公開ウィンドウの考え方。
-- 総選挙を非公開にしたいときは unpublished_at を過去日時にして再投入する。
--
-- election_candidates: 候補（キャラクター / 作品）。表示名と画像は投入時に
-- frontmatter から書き写して持つ（D1 の Annict キャッシュに無い候補も
-- 出せるよう非正規化）。再投入は (election_slug, kind, annict_id) で upsert
-- し、frontmatter から外れた候補行はスクリプトが削除する（その候補への
-- 票は ON DELETE CASCADE で一緒に消える）。
--
-- election_votes: 行が存在する = そのユーザーが投票済み。
-- (election_slug, user_id) の一意制約で 1 アカウント 1 票を担保し、
-- 期間中の投票先変更は candidate_id の更新で行う（issue #438 の決定）。
CREATE TABLE `elections` (
  `slug` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `body` text,
  `cover_image_url` text,
  `starts_at` integer NOT NULL,
  `ends_at` integer NOT NULL,
  `published_at` integer NOT NULL,
  `unpublished_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `elections_published_idx` ON `elections` (`published_at`);
--> statement-breakpoint
CREATE TABLE `election_candidates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `election_slug` text NOT NULL,
  `kind` text NOT NULL,
  `annict_id` integer NOT NULL,
  `name` text NOT NULL,
  `image_url` text,
  `position` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`election_slug`) REFERENCES `elections`(`slug`) ON DELETE CASCADE,
  CONSTRAINT `election_candidates_kind_check` CHECK (`kind` IN ('character', 'work'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `election_candidates_election_kind_annict_unique` ON `election_candidates` (`election_slug`, `kind`, `annict_id`);
--> statement-breakpoint
CREATE INDEX `election_candidates_election_idx` ON `election_candidates` (`election_slug`);
--> statement-breakpoint
CREATE TABLE `election_votes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `election_slug` text NOT NULL,
  `candidate_id` integer NOT NULL,
  `user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`election_slug`) REFERENCES `elections`(`slug`) ON DELETE CASCADE,
  FOREIGN KEY (`candidate_id`) REFERENCES `election_candidates`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `election_votes_election_user_unique` ON `election_votes` (`election_slug`, `user_id`);
--> statement-breakpoint
CREATE INDEX `election_votes_candidate_idx` ON `election_votes` (`candidate_id`);
