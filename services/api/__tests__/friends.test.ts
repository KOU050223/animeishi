import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { friends } from "@/routes/friends";
import { users } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_friendA001";
const USER_B = "user_friendB002";

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
  app.route("/me/friends", friends);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

describe("フレンド API", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();

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

  describe("認証なし", () => {
    it("GET /me/friends: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("認証あり", () => {
    beforeEach(() => {
      signInAs(USER_A);
    });

    it("GET /me/friends: 初期状態は空配列", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    it("POST /me/friends: フレンドを追加できる", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { friendId: string };
      expect(body.friendId).toBe(USER_B);
    });

    it("POST /me/friends: 双方向で登録される（A→B 追加時に B→A も登録）", async () => {
      const app = buildApp();
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );

      // A 視点でフレンドに B がいる
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyA = (await resA.json()) as { friendId: string }[];
      expect(bodyA).toHaveLength(1);
      expect(bodyA[0].friendId).toBe(USER_B);

      // B 視点でもフレンドに A がいる
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyB = (await resB.json()) as { friendId: string }[];
      expect(bodyB).toHaveLength(1);
      expect(bodyB[0].friendId).toBe(USER_A);
    });

    it("GET /me/friends: 相手のプロフィール情報が含まれる", async () => {
      const app = buildApp();
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );

      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { username: string }[];
      expect(body[0].username).toBe("ユーザーB");
    });

    it("POST /me/friends: 重複追加しても成功する（冪等）", async () => {
      const app = buildApp();
      const payload = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId: USER_B }),
      };

      await app.request("/me/friends", payload, TEST_BINDINGS);
      const res = await app.request("/me/friends", payload, TEST_BINDINGS);
      expect(res.status).toBe(201);

      const getRes = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await getRes.json()) as unknown[];
      expect(body).toHaveLength(1);
    });

    it("POST /me/friends: 自分自身を追加しようとすると 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_A }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("POST /me/friends: 存在しないユーザーは 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: "user_nonexistent" }),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(404);
    });

    it("POST /me/friends: friendId が無い場合は 400", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(400);
    });

    it("DELETE /me/friends/:friendId: 双方向で削除できる", async () => {
      const app = buildApp();
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );

      const delRes = await app.request(
        `/me/friends/${USER_B}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(delRes.status).toBe(200);

      // A 視点で空
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await resA.json()) as unknown[]).toHaveLength(0);

      // B 視点でも空（双方向削除）
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await resB.json()) as unknown[]).toHaveLength(0);
    });
  });
});
