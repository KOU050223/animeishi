import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { watchHistory } from "@/routes/watch-history";
import { users, animeTitles } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testwh001";

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

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/me/watch-histories", watchHistory);
  return app;
}

describe("視聴履歴 API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;
  let animeId: number;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    // テスト用アニメ・ユーザーを事前作成
    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const [anime] = await db
      .insert(animeTitles)
      .values({
        title: "テストアニメ",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: animeTitles.id });
    animeId = anime.id;
  });

  describe("認証なし", () => {
    it("GET /me/watch-histories: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      vi.mocked(getAuth).mockReturnValue({
        userId: USER_ID,
      } as ReturnType<typeof getAuth>);
    });

    it("GET /me/watch-histories: 初期状態は空配列", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    it("PUT /me/watch-histories/:animeId: 視聴履歴を追加できる", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "watching" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        animeId: number;
        status: string;
      };
      expect(body.animeId).toBe(animeId);
      expect(body.status).toBe("watching");
    });

    it("PUT /me/watch-histories/:animeId: スコアとコメントを保存できる", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            score: 9,
            comment: "名作",
          }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        score: number;
        comment: string;
      };
      expect(body.status).toBe("completed");
      expect(body.score).toBe(9);
      expect(body.comment).toBe("名作");
    });

    it("PUT /me/watch-histories/:animeId: ステータスを更新できる（upsert）", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "watching" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed", score: 8 }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; score: number };
      expect(body.status).toBe("completed");
      expect(body.score).toBe(8);
    });

    it("PUT /me/watch-histories/:animeId: 追加後 GET で取得できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "plan_to_watch" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { animeId: number; status: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].animeId).toBe(animeId);
      expect(body[0].status).toBe("plan_to_watch");
    });

    it("DELETE /me/watch-histories/:animeId: 視聴履歴を削除できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "watching" }),
        },
        TEST_BINDINGS,
      );

      const deleteRes = await app.request(
        `/me/watch-histories/${animeId}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(deleteRes.status).toBe(200);

      const getRes = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(0);
    });

    it("PUT /me/watch-histories/:animeId: バリデーションエラー（不正なステータス）は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "invalid_status" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/watch-histories/:animeId: スコアが範囲外（11）は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${animeId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "watching", score: 11 }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/watch-histories/:animeId: 存在しないアニメIDは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories/99999",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "watching" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });
  });
});
