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
    CLERK_AUTHORIZED_PARTIES?: string;
  };
};

// 任意認証向け: サインインしていれば clerkUserId が入る。未認証でも通る。
export type OptionalAuthVariables = {
  Variables: {
    clerkUserId?: string;
  };
};

export type OptionalAuthEnv = OptionalAuthVariables & {
  Bindings: Env & {
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
    CLERK_AUTHORIZED_PARTIES?: string;
  };
};

/**
 * CLERK_AUTHORIZED_PARTIES（カンマ区切り）を clerkMiddleware の
 * authorizedParties オプションに変換する。azp クレームを持つトークン
 * （Web ブラウザ発行）が許可オリジン以外から来ていないか検証する用途。
 * 未設定・空の場合は undefined を返し、azp 検証自体を無効にする。
 * azp を持たないネイティブアプリのトークンは設定の有無に関わらず通過する。
 */
function resolveAuthorizedParties(
  raw: string | undefined,
): string[] | undefined {
  const parties = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parties.length > 0 ? parties : undefined;
}

/**
 * Clerk JWT 検証ミドルウェア。
 * CLERK_SECRET_KEY バインディングが必要。
 * 認証成功時は c.var.clerkUserId にユーザーIDをセットする。
 * 認証失敗時は 401 を返す。
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  // @hono/clerk-auth はリクエストごとに動的に secretKey を渡す必要がある
  const authorizedParties = resolveAuthorizedParties(
    c.env.CLERK_AUTHORIZED_PARTIES,
  );
  const middleware = clerkMiddleware({
    secretKey: c.env.CLERK_SECRET_KEY,
    publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
    // exactOptionalPropertyTypes のため未設定時はキー自体を渡さない
    ...(authorizedParties ? { authorizedParties } : {}),
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

/**
 * 任意認証ミドルウェア。公開エンドポイント（GET /user/:uid 等）で
 * 「サインインしていれば誰が見ているか」を拾うために使う。
 * トークンが無い・無効な場合は匿名閲覧としてそのまま通す（401 にしない）。
 * users テーブルへのプロビジョニングは行わない（公開 GET で書き込まないため）。
 */
export const optionalAuth = createMiddleware<OptionalAuthEnv>(
  async (c, next) => {
    // Clerk キー未設定の環境では認証を試みず匿名扱いにする。
    if (!c.env.CLERK_SECRET_KEY || !c.env.CLERK_PUBLISHABLE_KEY) {
      await next();
      return;
    }
    const authorizedParties = resolveAuthorizedParties(
      c.env.CLERK_AUTHORIZED_PARTIES,
    );
    const middleware = clerkMiddleware({
      secretKey: c.env.CLERK_SECRET_KEY,
      publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      // exactOptionalPropertyTypes のため未設定時はキー自体を渡さない
      ...(authorizedParties ? { authorizedParties } : {}),
    });
    await middleware(c as unknown as Context, async () => {});

    const auth = getAuth(c as unknown as Context);
    if (auth?.userId) {
      c.set("clerkUserId", auth.userId);
    }
    await next();
  },
);
