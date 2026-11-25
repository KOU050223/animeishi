import { createFeedbackRoute } from "./schema";
import { FeedbackRateLimitError, feedbackRepository } from "./repository";
import { requireAuth } from "#src/middleware/auth";
import type { AuthVariables } from "#src/middleware/auth";
import { createDb } from "#src/db/client";
import { notifyFeedback } from "#src/observability";
import { createOpenApiApp } from "#src/lib/openapi";

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const feedbackRoute = app.openapi(createFeedbackRoute, async (c) => {
  const input = c.req.valid("json");
  const db = createDb((c.env as { DB: D1Database }).DB);
  try {
    await feedbackRepository(db, c.var.clerkUserId).create(input);
  } catch (e) {
    if (e instanceof FeedbackRateLimitError) {
      c.header("Retry-After", String(e.retryAfterSeconds));
      return c.json({ error: e.message }, 429);
    }
    throw e;
  }
  notifyFeedback(c);
  return c.json({ success: true }, 201);
});

export { feedbackRoute };
