import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { favorites } from "@/routes/favorites";
import { users, annictWorks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_testfav001";
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
  app.route("/me/favorites", favorites);
  return app;
}

describe("お気に入り API", () => {
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
    it("GET /me/favorites: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/favorites",
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

    it("GET /me/favorites: 初期状態は空配列", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/favorites",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    it("POST /me/favorites/:annictWorkId: お気に入りに追加できる", async () => {
      const app = buildApp();
      const res = await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { annictWorkId: number };
      expect(body.annictWorkId).toBe(ANNICT_WORK_ID);
    });

    it("POST /me/favorites/:annictWorkId: 重複追加しても成功する（冪等）", async () => {
      const app = buildApp();

      await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(201);

      const getRes = await app.request(
        "/me/favorites",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(1);
    });

    it("POST /me/favorites/:annictWorkId: 追加後 GET で取得できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/favorites",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { annictWorkId: number }[];
      expect(body).toHaveLength(1);
      expect(body[0].annictWorkId).toBe(ANNICT_WORK_ID);
    });

    it("DELETE /me/favorites/:annictWorkId: お気に入りを削除できる", async () => {
      const app = buildApp();

      await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      const deleteRes = await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(deleteRes.status).toBe(200);

      const getRes = await app.request(
        "/me/favorites",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(0);
    });

    it("POST /me/favorites/:annictWorkId: 存在しない作品IDは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/favorites/99999",
        { method: "POST" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });

    it("POST /me/favorites/:annictWorkId: 不正な作品IDは 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/favorites/abc",
        { method: "POST" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("POST /me/favorites/:annictWorkId: users 未登録ユーザーでも自動プロビジョニングされ追加できる", async () => {
      // 事前に users へ登録していない別ユーザーで認証する。
      // requireAuth の ensureUserExists により外部キー制約を満たすため、
      // 500（FOREIGN KEY constraint failed）にならず追加できる。
      const NEW_USER_ID = "user_testfav_new";
      vi.mocked(getAuth).mockReturnValue({
        userId: NEW_USER_ID,
      } as ReturnType<typeof getAuth>);

      const app = buildApp();
      const res = await app.request(
        `/me/favorites/${ANNICT_WORK_ID}`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { annictWorkId: number };
      expect(body.annictWorkId).toBe(ANNICT_WORK_ID);
    });
  });
});
