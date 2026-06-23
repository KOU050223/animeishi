import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const favorites = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getMyFavorites();
    return c.json(data, 200);
  })
  .post("/:animeId", async (c) => {
    const animeId = Number(c.req.param("animeId"));
    if (!Number.isSafeInteger(animeId) || animeId <= 0) {
      return c.json({ error: "Invalid animeId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    const existing = await adb.getAnimeTitleById(animeId);
    if (!existing) {
      return c.json({ error: "Anime not found" }, 404);
    }

    const result = await adb.addFavorite(animeId);
    return c.json(result, 201);
  })
  .delete("/:animeId", async (c) => {
    const animeId = Number(c.req.param("animeId"));
    if (!Number.isSafeInteger(animeId) || animeId <= 0) {
      return c.json({ error: "Invalid animeId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.removeFavorite(animeId);
    return c.json({ success: true }, 200);
  });

export { favorites };
