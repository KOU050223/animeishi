import { Hono } from "hono";
import { createDb } from "./db/client.js";
import type { Env } from "./db/client.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
