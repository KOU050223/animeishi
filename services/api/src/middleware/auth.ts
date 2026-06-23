import { clerkMiddleware, getAuth } from "@clerk/hono";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { Env } from "@/db/client";
import { createDb } from "@/db/client";
import { authorizedDb } from "@/repository/authorizedDb";

// hono/client (RPC) 向け: Bindingsを含まない型。RNアプリ側でも安全にimportできる
export type AuthVariables = {
  Variables: {
    clerkUserId: string;
  };
};

// サーバー実装向け: Workers Bindings込みの完全な型
export type AuthEnv = AuthVariables & {
  Bindings: Env & {
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
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

  // Clerk 認証済みユーザーを users テーブルへプロビジョニングする。
  // watch_history / favorites などの外部キー制約を満たすため、
  // 認証を必要とする全エンドポイントで初回アクセス時に登録される。
  // 表示名は Clerk のユーザー情報（username / 氏名）から解決する。
  // Clerk API 呼び出しは users 未登録の初回のみ行われる（ensureUserExists 側で制御）。
  const db = createDb((c.env as { DB: D1Database }).DB);
  await authorizedDb(db, auth.userId).ensureUserExists(async () => {
    const clerk = c.get("clerk");
    const user = await clerk.users.getUser(auth.userId);
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return user.username ?? (fullName || null);
  });

  await next();
});
