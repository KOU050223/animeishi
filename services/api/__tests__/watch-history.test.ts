import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { watchHistory } from "@/routes/watch-history";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testwh001";
const ANNICT_WORK_ID = 12345;

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

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

    // テスト用 annict_work・ユーザーを事前作成
    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(annictWorks).values({
      annictWorkId: ANNICT_WORK_ID,
      title: "テストアニメ",
      updatedAt: now,
    });
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

    it("PUT /me/watch-histories/:annictWorkId: 視聴履歴を追加できる", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        annictWorkId: number;
        state: string;
      };
      expect(body.annictWorkId).toBe(ANNICT_WORK_ID);
      expect(body.state).toBe("WATCHING");
    });

    it("PUT /me/watch-histories/:annictWorkId: ステータスを更新できる（upsert）", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHED" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { state: string };
      expect(body.state).toBe("WATCHED");
    });

    it("PUT /me/watch-histories/:annictWorkId: 追加後 GET で取得できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WANNA_WATCH" }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/watch-histories",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        annictWorkId: number;
        state: string;
      }[];
      expect(body).toHaveLength(1);
      expect(body[0].annictWorkId).toBe(ANNICT_WORK_ID);
      expect(body[0].state).toBe("WANNA_WATCH");
    });

    it("DELETE /me/watch-histories/:annictWorkId: 視聴履歴を削除できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      const deleteRes = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
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

    it("PUT /me/watch-histories/:annictWorkId: バリデーションエラー（不正なステータス）は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/watch-histories/${ANNICT_WORK_ID}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "invalid_status" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("PUT /me/watch-histories/:annictWorkId: 存在しない作品IDは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/watch-histories/99999",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "WATCHING" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });
  });
});
