import { Hono } from "hono";
import type { Env } from "./db/client";
import { me } from "./routes/me";
import { titles } from "./routes/titles";
import { watchHistory } from "./routes/watch-history";

const app = new Hono<{ Bindings: Env }>();

const routes = app
  .get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  })
  .route("/me", me)
  .route("/me/watch-histories", watchHistory)
  .route("/titles", titles);

export type AppType = typeof routes;
export default routes;
