import { Hono } from "hono";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { requireAuth } from "@/middleware/auth";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";

const CACHE_KEY = "https://animeishi.internal/cache/titles";
const CACHE_TTL = 3600;

const titles = new Hono<AuthVariables>();

titles.use("*", requireAuth);

/**
 * GET /titles
 * アニメ一覧を返す。Cloudflare Cache API で TTL=1時間キャッシュ。
 */
titles.get("/", async (c) => {
  const env = c.env as AuthEnv["Bindings"] & { DB: unknown; ENVIRONMENT?: string };
  const isProd = env.ENVIRONMENT === "production";

  if (isProd) {
    const cache = caches.default;
    const cacheReq = new Request(CACHE_KEY);

    const cached = await cache.match(cacheReq);
    if (cached) {
      return cached;
    }

    const db = createDb(env.DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const data = await adb.getAnimeTitles();

    const response = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
      },
    });

    try {
      c.executionCtx.waitUntil(cache.put(cacheReq, response.clone()));
    } catch {
      // ExecutionContext が存在しない場合は無視する
    }

    return response;
  }

  const db = createDb(env.DB);
  const adb = authorizedDb(db, c.var.clerkUserId);
  const data = await adb.getAnimeTitles();

  return c.json(data);
});

export { titles };
