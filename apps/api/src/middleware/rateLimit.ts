import { createMiddleware } from "hono/factory";

/**
 * 書き込み系 API のユーザー単位の流量制限に使う Workers Rate Limiting
 * バインディング（wrangler.toml の [[ratelimits]]、issue #715）。
 * 設定しない環境（ローカル・テスト）があるためすべて optional。
 */
export type UserRateLimitBindings = {
  // 通報全般（POST /users/:id/report, /work-lists/:id/report,
  // /tier-lists/:kind/:id/report）
  REPORT_RATE_LIMITER?: RateLimit;
  // フィードバック（POST /feedback）
  FEEDBACK_RATE_LIMITER?: RateLimit;
  // フレンド申請の作成（POST /me/friend-requests）
  FRIEND_REQUEST_RATE_LIMITER?: RateLimit;
  // いいね・いいね解除（PUT/DELETE .../like）
  LIKE_RATE_LIMITER?: RateLimit;
};

export type UserRateLimiterName = keyof UserRateLimitBindings;

/**
 * requireAuth の後に掛けるレート制限（issue #715）。キーは clerkUserId。
 * OpenAPI ルートは createRoute の middleware、素の Hono ルートは
 * ハンドラ引数として掛ける。
 *
 * limit() 自体が失敗したときは fail-open で通す。書き込み API を
 * バインディングの障害で止めないため（通報・フィードバックは DB 側の
 * 既存制限が残る。images の retryGate とは違いこちらは公開配信ではない）。
 *
 * 超過時は 429 + Retry-After: 60。Workers Rate Limiting の period は
 * 10 / 60 秒しか選べず、現在の定義はすべて 60 秒なので最長 60 秒で解除
 * される。応答の code は mobile 側（getReportErrorMessage）が制限種別を
 * 見分けるために付ける。
 */
export const userRateLimit = (name: UserRateLimiterName) =>
  createMiddleware<{
    Bindings: UserRateLimitBindings;
    Variables: { clerkUserId: string };
  }>(async (c, next) => {
    const limiter = c.env[name];
    if (!limiter) {
      await next();
      return;
    }
    const result = await limiter
      .limit({ key: c.var.clerkUserId })
      .catch(() => undefined);
    if (result === undefined) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "rate_limiter_unavailable",
          limiter: name,
        }),
      );
      await next();
      return;
    }
    if (!result.success) {
      c.header("Retry-After", "60");
      return c.json(
        {
          error: "リクエストが多すぎます。しばらくしてからお試しください",
          code: "rate_limited",
        },
        429,
      );
    }
    await next();
  });
