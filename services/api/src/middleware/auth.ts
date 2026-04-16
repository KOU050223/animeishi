import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { Env } from "@/db/client";

export type AuthEnv = {
  Bindings: Env & {
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

/**
 * Clerk JWT 検証ミドルウェア。
 * CLERK_SECRET_KEY バインディングが必要。
 * 認証成功時は c.var.clerkUserId にユーザーIDをセットする。
 * 認証失敗時は 401 を返す。
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  // @hono/clerk-auth はリクエストごとに動的に secretKey を渡す必要がある
  const middleware = clerkMiddleware({
    secretKey: c.env.CLERK_SECRET_KEY,
    publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
  });
  await middleware(c as unknown as Context, async () => {});

  const auth = getAuth(c as unknown as Context);
  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("clerkUserId", auth.userId);
  await next();
});
