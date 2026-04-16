import { Hono } from "hono";
import type { Env } from "./db/client.js";
import { me } from "./routes/me.js";

const app = new Hono<{ Bindings: Env }>();

const routes = app
  .get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  })
  .route("/me", me);

export type AppType = typeof routes;
export default app;
