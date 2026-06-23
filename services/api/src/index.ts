import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./db/client";
import { favorites } from "./routes/favorites";
import { me } from "./routes/me";
import { titles } from "./routes/titles";
import { watchHistory } from "./routes/watch-history";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

const routes = app
  .get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  })
  .route("/me", me)
  .route("/me/watch-histories", watchHistory)
  .route("/me/favorites", favorites)
  .route("/titles", titles);

export type AppType = typeof routes;
export default routes;
