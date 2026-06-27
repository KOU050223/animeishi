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
  .put(
    "/:annictWorkId",
    zValidator("json", watchHistoryUpsertSchema),
    async (c) => {
      const annictWorkId = Number(c.req.param("annictWorkId"));
      if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
        return c.json({ error: "Invalid annictWorkId" }, 400);
      }

      const data = c.req.valid("json");
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);

      const existing = await adb.getAnnictWorkById(annictWorkId);
      if (!existing) {
        return c.json({ error: "Work not found" }, 404);
      }

      const result = await adb.upsertWatchHistory(annictWorkId, {
        state: data.state,
      });

      return c.json(result, 200);
    },
  )
  .delete("/:annictWorkId", async (c) => {
    const annictWorkId = Number(c.req.param("annictWorkId"));
    if (!Number.isSafeInteger(annictWorkId) || annictWorkId <= 0) {
      return c.json({ error: "Invalid annictWorkId" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    await adb.deleteWatchHistory(annictWorkId);
    return c.json({ success: true }, 200);
  });

export { watchHistory };
