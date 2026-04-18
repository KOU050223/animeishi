import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { profileUpdateSchema } from "@/schema/validators";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

const me = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/profile", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const profile = await adb.getMyProfile();

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    return c.json(profile);
  })
  .put("/profile", zValidator("json", profileUpdateSchema), async (c) => {
    const data = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    const profile = await adb.upsertMyProfile({
      username: data.username ?? c.var.clerkUserId,
      bio: data.bio ?? null,
      favoriteQuote: data.favoriteQuote ?? null,
      isPublic: data.isPublic ?? true,
      profileImageUrl: null,
    });

    if (data.selectedGenres !== undefined) {
      await adb.setMyGenres(data.selectedGenres);
    }

    return c.json(profile);
  });

export { me };
