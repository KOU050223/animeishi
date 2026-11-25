import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { usersRoute } from "#src/features/users/index";
import { publicUsersRoute } from "#src/features/users/public";
import { publicWorkListsRoute } from "#src/features/work-lists/public";
import { publicTierListsRoute } from "#src/features/public-tier-lists/index";
import { friendRequests } from "#src/features/friend-requests/index";
import { feedbackRoute } from "#src/features/feedback/index";
import { reports, users } from "#src/db/schema";
import type { UserRateLimitBindings } from "#src/middleware/rateLimit";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
  withScope: (fn: (scope: unknown) => void) => fn(sentryScope),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// notifyUserReport が scope に載せる fingerprint / タグを検証するため、
// withScope に渡す scope を共通化して spy する。
const sentryScope = vi.hoisted(() => ({
  setTag: vi.fn(),
  setContext: vi.fn(),
  setFingerprint: vi.fn(),
}));

import { getAuth } from "@clerk/hono";
import { captureMessage } from "@sentry/cloudflare";

const USER_A = "user_rlA001";
const USER_B = "user_rlB002";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    AVATARS: R2Bucket;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  } & UserRateLimitBindings;
  Variables: {
    clerkUserId?: string;
  };
};

const TEST_BINDINGS = {
  DB: env.DB,
  AVATARS: env.AVATARS,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/users", usersRoute);
  app.route("/users", publicUsersRoute);
  app.route("/work-lists", publicWorkListsRoute);
  app.route("/tier-lists", publicTierListsRoute);
  app.route("/me/friend-requests", friendRequests);
  app.route("/feedback", feedbackRoute);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) };
}

function bindingsWith(
  name: keyof UserRateLimitBindings,
  rateLimiter: ReturnType<typeof limiter>,
) {
  return { ...TEST_BINDINGS, [name]: rateLimiter };
}

const postJson = (
  app: ReturnType<typeof buildApp>,
  path: string,
  body: unknown,
  bindings: object = TEST_BINDINGS,
) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings,
  );

const put = (
  app: ReturnType<typeof buildApp>,
  path: string,
  bindings: object = TEST_BINDINGS,
) => app.request(path, { method: "PUT" }, bindings);

// 書き込み系 API のユーザー単位流量制限（issue #715）。binding を拒否する
// モックに差し替えて、各エンドポイントで 429 が返ることを確認する。
// 通報・フィードバックには別系統の DB 制限もあるため、ここで検証する
// 429 は edge のミドルウェア由来（body.code = "rate_limited"）。
describe("ユーザー単位の流量制限（issue #715）", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.mocked(captureMessage).mockClear();
    sentryScope.setTag.mockClear();
    sentryScope.setContext.mockClear();
    sentryScope.setFingerprint.mockClear();

    const now = new Date();
    await db.insert(users).values([
      {
        id: USER_A,
        username: "ユーザーA",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: USER_B,
        username: "ユーザーB",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  describe("上限超過は 429", () => {
    it("POST /users/:id/report", async () => {
      signInAs(USER_A);
      const rateLimiter = limiter(false);
      const app = buildApp();
      const res = await postJson(
        app,
        `/users/${USER_B}/report`,
        { reason: "不適切なコンテンツ" },
        bindingsWith("REPORT_RATE_LIMITER", rateLimiter),
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      const body = (await res.json()) as { error?: string; code?: string };
      expect(body.code).toBe("rate_limited");
      expect(rateLimiter.limit).toHaveBeenCalledWith({ key: USER_A });

      // ハンドラには到達しない（記録・運営通知ともに無し）
      expect(await db.select().from(reports)).toHaveLength(0);
      expect(vi.mocked(captureMessage)).not.toHaveBeenCalled();
    });

    it("POST /work-lists/:id/report", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/work-lists/1/report",
        { reason: "不適切なコンテンツ" },
        bindingsWith("REPORT_RATE_LIMITER", limiter(false)),
      );
      expect(res.status).toBe(429);
    });

    it("POST /tier-lists/:id/report", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/tier-lists/1/report",
        { reason: "不適切なコンテンツ" },
        bindingsWith("REPORT_RATE_LIMITER", limiter(false)),
      );
      expect(res.status).toBe(429);
    });

    it("POST /feedback", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/feedback",
        { category: "bug", body: "バグです" },
        bindingsWith("FEEDBACK_RATE_LIMITER", limiter(false)),
      );
      expect(res.status).toBe(429);
    });

    it("POST /me/friend-requests", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/me/friend-requests",
        { userId: USER_B },
        bindingsWith("FRIEND_REQUEST_RATE_LIMITER", limiter(false)),
      );
      expect(res.status).toBe(429);
    });

    it.each([
      ["PUT", `/users/${USER_B}/like`],
      ["DELETE", `/users/${USER_B}/like`],
      ["PUT", "/work-lists/1/like"],
      ["DELETE", "/work-lists/1/like"],
      ["PUT", "/tier-lists/1/like"],
      ["DELETE", "/tier-lists/1/like"],
    ])("%s %s", async (method, path) => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        path,
        { method },
        bindingsWith("LIKE_RATE_LIMITER", limiter(false)),
      );
      expect(res.status).toBe(429);
    });
  });

  describe("制限内・制限不能は通す", () => {
    it("制限内なら clerkUserId をキーに数えてハンドラへ通す", async () => {
      signInAs(USER_A);
      const rateLimiter = limiter(true);
      const app = buildApp();
      const res = await postJson(
        app,
        `/users/${USER_B}/report`,
        { reason: "不適切なコンテンツ" },
        bindingsWith("REPORT_RATE_LIMITER", rateLimiter),
      );
      expect(res.status).toBe(201);
      expect(rateLimiter.limit).toHaveBeenCalledWith({ key: USER_A });
      expect(await db.select().from(reports)).toHaveLength(1);
    });

    it("POST /feedback は制限内なら通す", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/feedback",
        { category: "bug", body: "バグです" },
        bindingsWith("FEEDBACK_RATE_LIMITER", limiter(true)),
      );
      expect(res.status).toBe(201);
    });

    it("POST /me/friend-requests は制限内なら通す", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(
        app,
        "/me/friend-requests",
        { userId: USER_B },
        bindingsWith("FRIEND_REQUEST_RATE_LIMITER", limiter(true)),
      );
      expect(res.status).toBe(201);
    });

    it("いいねは制限内ならハンドラへ通す（未存在の対象は 404）", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await put(
        app,
        "/users/user_nonexistent/like",
        bindingsWith("LIKE_RATE_LIMITER", limiter(true)),
      );
      expect(res.status).toBe(404);
    });

    it("binding が未設定なら制限せず通す", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await postJson(app, "/feedback", {
        category: "bug",
        body: "バグです",
      });
      expect(res.status).toBe(201);
    });

    it("limit() が失敗しても書き込みを止めない（fail-open）", async () => {
      signInAs(USER_A);
      const failing = {
        limit: vi.fn(async (): Promise<{ success: boolean }> => {
          throw new Error("rate limiter unavailable");
        }),
      };
      const app = buildApp();
      const res = await postJson(
        app,
        "/feedback",
        { category: "bug", body: "バグです" },
        bindingsWith("FEEDBACK_RATE_LIMITER", failing),
      );
      expect(res.status).toBe(201);
    });

    it("対象外のリクエストは数えない（GET /me/friend-requests）", async () => {
      signInAs(USER_A);
      const rateLimiter = limiter(false);
      const app = buildApp();
      const res = await app.request(
        "/me/friend-requests",
        { method: "GET" },
        bindingsWith("FRIEND_REQUEST_RATE_LIMITER", rateLimiter),
      );
      expect(res.status).toBe(200);
      expect(rateLimiter.limit).not.toHaveBeenCalled();
    });
  });
});
