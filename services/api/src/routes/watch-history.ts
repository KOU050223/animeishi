import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
import { watchHistoryUpsertSchema } from "@/schema/validators";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const watchHistory = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getMyWatchHistory();
    return c.json(data, 200);
  })
  .put("/:animeId", zValidator("json", watchHistoryUpsertSchema), async (c) => {
    const animeId = Number(c.req.param("animeId"));
    if (!Number.isInteger(animeId) || animeId <= 0) {
      return c.json({ error: "Invalid animeId" }, 400);
    }

    const data = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    const existing = await adb.getAnimeTitleById(animeId);
    if (!existing) {
      return c.json({ error: "Anime not found" }, 404);
    }

    const result = await adb.upsertWatchHistory(animeId, {
      status: data.status,
      score: data.score ?? null,
      comment: data.comment ?? null,
      watchedAt: data.watchedAt ? new Date(data.watchedAt) : null,
    });

    return c.json(result, 200);
  })
  .delete("/:animeId", async (c) => {
    const animeId = Number(c.req.param("animeId"));
    if (!Number.isInteger(animeId) || animeId <= 0) {
      return c.json({ error: "Invalid animeId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.deleteWatchHistory(animeId);
    return c.json({ success: true }, 200);
  });

export { watchHistory };
