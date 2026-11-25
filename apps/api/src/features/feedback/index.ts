import { createFeedbackRoute } from "./schema";
import { FeedbackRateLimitError, feedbackRepository } from "./repository";
import { requireAuth } from "@/middleware/auth";
import type { AuthVariables } from "@/middleware/auth";
import { createDb } from "@/db/client";
import { notifyFeedback } from "@/observability";
import { createOpenApiApp } from "@/lib/openapi";

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
