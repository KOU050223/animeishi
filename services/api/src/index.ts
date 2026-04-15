import { Hono } from "hono";
import type { Env } from "./db/client.js";

const app = new Hono<{ Bindings: Env }>();

const routes = app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export type AppType = typeof routes;
export default app;
