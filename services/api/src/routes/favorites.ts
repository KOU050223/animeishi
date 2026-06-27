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
  .post("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    const existing = await adb.getAnnictWorkById(annictWorkId);
    if (!existing) {
      return c.json({ error: "Work not found" }, 404);
    }

    const result = await adb.addFavorite(annictWorkId);
    return c.json(result, 201);
  })
  .delete("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.removeFavorite(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { favorites };
