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

  let userId: string;
  try {
    // handshake が必要なリクエスト（Accept: text/html のドキュメント取得など）
    // では clerkMiddleware が next を呼ばずリダイレクト応答を返す。
    // その場合 auth が未設定で getAuth が throw するため、API としては
    // handshake 応答をそのまま返さず 401 にする（issue #154）。
    if (await middleware(c as unknown as Context, async () => {})) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const auth = getAuth(c as unknown as Context);
    if (!auth?.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    userId = auth.userId;
  } catch {
    // authenticateRequest / getAuth の例外は 401 に丸める。
    // 以前は getAuth の throw が未処理で 500 になっていた。
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("clerkUserId", userId);

  // Clerk 認証済みユーザーを users テーブルへプロビジョニングする。
  // watch_history / favorites などの外部キー制約を満たすため、
  // 認証を必要とする全エンドポイントで初回アクセス時に登録される。
  // 表示名は Clerk のユーザー情報（username / 氏名）から解決する。
  // Clerk API 呼び出しは users 未登録の初回のみ行われる（ensureUserExists 側で制御）。
  const db = createDb((c.env as { DB: D1Database }).DB);
  await authorizedDb(db, userId).ensureUserExists(async () => {
    const clerk = c.get("clerk");
    const user = await clerk.users.getUser(userId);
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
    // Bearer トークンを持たないリクエスト（SNS クローラーやブラウザの
    // ドキュメント取得など）は Clerk を呼ばず匿名扱いにする。
    // 呼ぶと Accept: text/html なリクエストで Clerk が handshake 応答を返し、
    // auth 未設定のまま getAuth が throw して 500 になる（issue #154）。
    const authorization = c.req.header("Authorization") ?? "";
    const hasBearerToken = /^bearer\s+\S/i.test(authorization);
    // Clerk キー未設定の環境でも認証を試みず匿名扱いにする。
    if (
      !hasBearerToken ||
      !c.env.CLERK_SECRET_KEY ||
      !c.env.CLERK_PUBLISHABLE_KEY
    ) {
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
    try {
      // handshake 応答（Response が返り next が呼ばれない）や
      // authenticateRequest / getAuth の例外は匿名閲覧にフォールバックする。
      // 公開エンドポイントなので Clerk のリダイレクトは返さない。
      if (!(await middleware(c as unknown as Context, async () => {}))) {
        const auth = getAuth(c as unknown as Context);
        if (auth?.userId) {
          c.set("clerkUserId", auth.userId);
        }
      }
    } catch {
      // 無効トークン等による例外は匿名として扱う（401 にはしない）。
    }
    await next();
  },
);
