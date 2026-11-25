import { createDb } from "#src/db/client";
import { createOpenApiApp } from "#src/lib/openapi";
import { workImageUrl } from "#src/lib/catalog/workImage";
import { requireAuth } from "#src/middleware/auth";
import type { AuthVariables } from "#src/middleware/auth";
import { commonRepository } from "./repository";
import { getCommonRoute } from "./schema";

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
export const common = app.openapi(getCommonRoute, async (c) => {
  const db = createDb((c.env as { DB: D1Database }).DB);
  const repo = commonRepository(db, c.var.clerkUserId);
  const { id } = c.req.valid("param");
  if (!(await repo.isAllowed(id))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const data = await repo.getCommon(id);
  const withImage = (works: { annictWorkId: number; title: string }[]) =>
    works.map((work) => ({
      ...work,
      hostedImageUrl: workImageUrl(c.req.url, work.annictWorkId),
    }));
  return c.json(
    {
      watchingTogether: withImage(data.watchingTogether),
      watchedTogetherCount: data.watchedTogetherCount,
      favoriteTogether: withImage(data.favoriteTogether),
      conversationStarters: withImage(data.conversationStarters),
    },
    200,
  );
});
