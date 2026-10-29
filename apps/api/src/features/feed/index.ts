import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { feedRepository } from "./repository";
import { getFeedRoute } from "./schema";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 1 ページの既定・上限件数。フィードはホーム画面の 1 セクションなので
// 過剰に取らない。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// フレンドの活動フィード（issue #265）。活動の記録は watch-history /
// favorites / tier-lists など各 feature のハンドラが行い、ここは閲覧専用。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const feed = app.openapi(getFeedRoute, async (c) => {
  const { cursor, limit: rawLimit } = c.req.valid("query");
  const limit = Math.min(Number(rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const db = createDb(getBindings(c).DB);
  const repo = feedRepository(db, c.var.clerkUserId);

  const rows = await repo.getFriendsFeed({
    cursor: cursor !== undefined ? Number(cursor) : undefined,
    limit,
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
    work: row.work
      ? {
          ...row.work,
          hostedImageUrl: workImageUrl(c.req.url, row.work.annictWorkId),
        }
      : null,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
  }));

  return c.json(
    {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    },
    200,
  );
});

export { feed };
