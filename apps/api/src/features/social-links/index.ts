import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { createDb } from "@/db/client";
import { socialLinksRepository } from "./repository";
import { updateSocialLinksSchema } from "./schema";

function getBindings(c: Context): { DB: D1Database } {
  return c.env as AuthEnv["Bindings"] & { DB: D1Database };
}

export const socialLinks = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const repo = socialLinksRepository(createDb(getBindings(c).DB));
    return c.json({
      items: await repo.list(c.var.clerkUserId, c.var.clerkUserId),
    });
  })
  .put("/", zValidator("json", updateSocialLinksSchema), async (c) => {
    const repo = socialLinksRepository(createDb(getBindings(c).DB));
    return c.json({
      items: await repo.replace(c.var.clerkUserId, c.req.valid("json").items),
    });
  });
