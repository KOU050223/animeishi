import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { articlesRepository } from "./repository";
import { getArticleRoute, listArticlesRoute } from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 1 ページの既定・上限件数。ホームの特集枠は limit=3 で引く。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 運営が書く特集記事（issue #437）。投入は
// scripts/publish-article.mjs（frontmatter 付き Markdown の upsert）
// が担うため、ここは閲覧専用。公開期間（published_at 〜 unpublished_at）
// 外の記事は一覧・詳細ともに返さない。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const list = app.openapi(listArticlesRoute, async (c) => {
  const { limit: rawLimit } = c.req.valid("query");
  const limit = Math.min(Number(rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const db = createDb(getBindings(c).DB);
  const repo = articlesRepository(db);

  const rows = await repo.listPublished({ now: new Date(), limit });

  return c.json(
    {
      items: rows.map((row) => ({
        ...row,
        publishedAt: row.publishedAt.toISOString(),
      })),
    },
    200,
  );
});

const articles = list.openapi(getArticleRoute, async (c) => {
  const { slug } = c.req.valid("param");
  const db = createDb(getBindings(c).DB);
  const repo = articlesRepository(db);

  const article = await repo.getPublished({ slug, now: new Date() });
  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }

  return c.json(
    {
      slug: article.slug,
      title: article.title,
      body: article.body,
      coverImageUrl: article.coverImageUrl,
      publishedAt: article.publishedAt.toISOString(),
    },
    200,
  );
});

export { articles };
