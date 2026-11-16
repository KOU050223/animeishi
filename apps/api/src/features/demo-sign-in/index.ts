import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { Context } from "hono";
import { createOpenApiApp } from "@/lib/openapi";
import { demoSignInRoute } from "./schema";

// Clerk ユーザーの public_metadata.demoAccount がこの値のアカウントだけを対象にする
// （apps/api/scripts/review-account.mjs が付ける。フレンド役の "friend" はログインさせない）。
export const REVIEW_DEMO_ACCOUNT_ROLE = "review";

// ticket はアプリが受け取ってすぐ使うので短くてよい。
const TICKET_TTL_SECONDS = 60;

type DemoSignInBindings = {
  CLERK_SECRET_KEY: string;
  DEMO_SIGN_IN_RATE_LIMITER?: RateLimit;
};

function getBindings(c: Context): DemoSignInBindings {
  return c.env as DemoSignInBindings;
}

const app = createOpenApiApp();

const demoSignIn = app.openapi(demoSignInRoute, async (c) => {
  const { email, password } = c.req.valid("json");
  const env = getBindings(c);

  // パスワード総当たりの対策。IP とアカウントの両方で数える
  // （IP だけだと分散した試行を、アカウントだけだと審査員への妨害を防げない）。
  const limiter = env.DEMO_SIGN_IN_RATE_LIMITER;
  if (!limiter) {
    throw new Error("DEMO_SIGN_IN_RATE_LIMITER binding is not configured");
  }
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const results = await Promise.all([
    limiter.limit({ key: `ip:${ip}` }),
    limiter.limit({ key: `email:${email.toLowerCase()}` }),
  ]);
  if (results.some((r) => !r.success)) {
    return c.json(
      { error: "試行回数が多すぎます。しばらくしてからお試しください" },
      429,
    );
  }

  // デモアカウントかどうか・パスワードが合うかを区別せず同じ 401 を返す
  // （どのアドレスがデモアカウントかを探られないようにする）。
  const unauthorized = () =>
    c.json({ error: "メールアドレスまたはパスワードが違います" }, 401);

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const { data: users } = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });
  const user = users[0];
  if (!user || user.publicMetadata?.demoAccount !== REVIEW_DEMO_ACCOUNT_ROLE) {
    return unauthorized();
  }

  try {
    await clerk.users.verifyPassword({ userId: user.id, password });
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status < 500) {
      return unauthorized();
    }
    throw error;
  }

  const { token } = await clerk.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: TICKET_TTL_SECONDS,
  });
  return c.json({ ticket: token }, 200);
});

export { demoSignIn };
