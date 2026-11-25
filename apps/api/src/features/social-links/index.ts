import type { Context } from "hono";
import { requireAuth } from "#src/middleware/auth";
import type { AuthEnv, AuthVariables } from "#src/middleware/auth";
import { createDb } from "#src/db/client";
import { createOpenApiApp } from "#src/lib/openapi";
import { socialLinksRepository } from "./repository";
import { getSocialLinksRoute, updateSocialLinksRoute } from "./schema";

function getBindings(c: Context): { DB: D1Database } {
  return c.env as AuthEnv["Bindings"] & { DB: D1Database };
}

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
export const socialLinks = app
  .openapi(getSocialLinksRoute, async (c) => {
    const repo = socialLinksRepository(createDb(getBindings(c).DB));
    return c.json(
      { items: await repo.list(c.var.clerkUserId, c.var.clerkUserId) },
      200,
    );
  })
  .openapi(updateSocialLinksRoute, async (c) => {
    const repo = socialLinksRepository(createDb(getBindings(c).DB));
    return c.json(
      {
        items: await repo.replace(c.var.clerkUserId, c.req.valid("json").items),
      },
      200,
    );
  });
