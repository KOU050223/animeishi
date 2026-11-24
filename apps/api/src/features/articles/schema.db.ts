import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// ---- articles (運営が書く特集記事, issue #437) ----
// 投入は scripts/publish-article.mjs（frontmatter 付き Markdown を slug で
// upsert）が担い、API 経路では書き込まない。published_at 〜 unpublished_at
// が公開期間で、unpublished_at が NULL の記事は公開終了期限なし。
// slug を主キーにする（記事詳細は GET /articles/:slug で引く）。
export const articles = sqliteTable(
  "articles",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    // 本文 Markdown。一覧応答には含めず詳細のみで返す。
    body: text("body").notNull(),
    coverImageUrl: text("cover_image_url"),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    unpublishedAt: integer("unpublished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("articles_published_idx").on(t.publishedAt)],
);

export type Article = typeof articles.$inferSelect;
