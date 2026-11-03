-- 運営が書く特集記事（issue #437）
--
-- articles: ホームの特集枠と記事詳細が読む記事データ。投入は
-- scripts/publish-article.mjs（frontmatter 付き Markdown を
-- slug で upsert）が担い、API 経路では書き込まない。
-- published_at は公開開始日時、unpublished_at は公開終了日時
-- （NULL は終了期限なし）で、両者で公開期間を表す。

CREATE TABLE `articles` (
  `slug` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `cover_image_url` text,
  `published_at` integer NOT NULL,
  `unpublished_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `articles_published_idx` ON `articles` (`published_at`);
