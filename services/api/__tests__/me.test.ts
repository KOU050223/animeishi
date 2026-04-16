import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db.js";
import { me } from "../src/routes/me.js";
import { users } from "../src/db/schema.js";
import { createDb } from "../src/db/client.js";

// @hono/clerk-auth の getAuth をモック
vi.mock("@hono/clerk-auth", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@hono/clerk-auth";

const USER_ID = "user_testme001";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
  Variables: {
    clerkUserId: string;
  };
};

function buildApp(d1: D1Database) {
  const app = new Hono<TestEnv>();
  app.route("/me", me);
  return app;
}

describe("GET /me/profile & PUT /me/profile", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
  });

  describe("認証なし（Authorizationヘッダーなし）", () => {
    it("401 を返す", async () => {
      // getAuth が null を返す = 未認証
      vi.mocked(getAuth).mockReturnValue(null as unknown as ReturnType<typeof getAuth>);

      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("認証あり（正しいJWT）", () => {
    beforeEach(() => {
      // 認証済みユーザーとして振る舞う
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /me/profile: プロフィール未作成なら 404", async () => {
      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "GET",
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(404);
    });

    it("PUT /me/profile: プロフィールを作成できる", async () => {
      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "テストユーザー",
          bio: "自己紹介",
          isPublic: true,
        }),
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(200);
      const body = await res.json() as { username: string; bio: string };
      expect(body.username).toBe("テストユーザー");
      expect(body.bio).toBe("自己紹介");
    });

    it("GET /me/profile: 作成後に取得できる", async () => {
      // 事前にプロフィールを作成
      const now = new Date();
      await db.insert(users).values({
        id: USER_ID,
        username: "既存ユーザー",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });

      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "GET",
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(200);
      const body = await res.json() as { username: string; id: string };
      expect(body.id).toBe(USER_ID);
      expect(body.username).toBe("既存ユーザー");
    });

    it("PUT /me/profile: プロフィールを更新できる", async () => {
      // 事前にプロフィールを作成
      const now = new Date();
      await db.insert(users).values({
        id: USER_ID,
        username: "旧ユーザー名",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });

      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "新ユーザー名",
          isPublic: false,
        }),
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(200);
      const body = await res.json() as { username: string; isPublic: boolean };
      expect(body.username).toBe("新ユーザー名");
      expect(body.isPublic).toBe(false);
    });

    it("PUT /me/profile: バリデーションエラー（username が空）は 400", async () => {
      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "" }),
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(400);
    });

    it("PUT /me/profile: selectedGenres を設定できる", async () => {
      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "ジャンルユーザー",
          selectedGenres: ["アクション", "SF"],
        }),
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(200);
    });
  });

  describe("不正なJWT（userId が null）", () => {
    it("401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue({
        userId: null,
      } as unknown as ReturnType<typeof getAuth>);

      const app = buildApp(env.DB);
      const res = await app.request("/me/profile", {
        method: "GET",
      }, { DB: env.DB, CLERK_SECRET_KEY: "test_secret", CLERK_PUBLISHABLE_KEY: "test_pub" });

      expect(res.status).toBe(401);
    });
  });
});
