import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { friends } from "@/features/friends";
import {
  issueQrExchangeToken,
  QR_EXCHANGE_TOKEN_TTL_SEC,
} from "@/features/friends/qrExchangeToken";
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
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.route("/me/friends", friends);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

// POST /me/friends（対面 QR の即時成立）は qrToken が必須（issue #417）。
// テストでは「相手が QR を表示した」状況を、同じ秘密で発行した正規
// トークンで再現する。
async function qrTokenFor(userId: string, skewSec = 0): Promise<string> {
  const { token } = await issueQrExchangeToken(
    "test_secret",
    userId,
    Math.floor(Date.now() / 1000) + skewSec,
  );
  return token;
}

async function postFriend(
  app: ReturnType<typeof buildApp>,
  friendId: string,
  body: Record<string, unknown> = {},
) {
  const qrToken =
    (body.qrToken as string | undefined) ?? (await qrTokenFor(friendId));
  return app.request(
    "/me/friends",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendId, qrToken, ...body }),
    },
    TEST_BINDINGS,
  );
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
      const res = await postFriend(app, USER_B);

      expect(res.status).toBe(201);
      const body = (await res.json()) as { friendId: string };
      expect(body.friendId).toBe(USER_B);
    });

    it("POST /me/friends: 双方向で登録される（A→B 追加時に B→A も登録）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      // A 視点でフレンドに B がいる
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyA = (await resA.json()) as { friendId: string }[];
      expect(bodyA).toHaveLength(1);
      expect(bodyA[0]?.friendId).toBe(USER_B);

      // B 視点でもフレンドに A がいる
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyB = (await resB.json()) as { friendId: string }[];
      expect(bodyB).toHaveLength(1);
      expect(bodyB[0]?.friendId).toBe(USER_A);
    });

    it("GET /me/friends: 相手のプロフィール情報が含まれる", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);

      const res = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const body = (await res.json()) as { username: string }[];
      expect(body[0]?.username).toBe("ユーザーB");
    });

    it("POST /me/friends: 重複追加しても成功する（冪等）", async () => {
      const app = buildApp();
      await postFriend(app, USER_B);
      const res = await postFriend(app, USER_B);
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
      const res = await postFriend(app, USER_A);

      expect(res.status).toBe(400);
    });

    it("POST /me/friends: 存在しないユーザーは 404", async () => {
      const app = buildApp();
      const res = await postFriend(app, "user_nonexistent", {
        qrToken: await qrTokenFor("user_nonexistent"),
      });

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
      await postFriend(app, USER_B);

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
      expect(await resA.json()).toHaveLength(0);

      // B 視点でも空（双方向削除）
      signInAs(USER_B);
      const resB = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(await resB.json()).toHaveLength(0);
    });
  });

  // 即時成立は対面 QR 交換に限る（issue #417 レビュー対応）。
  // qrToken 無しで相手 ID だけ渡しても承認を迂回できないことを担保する。
  describe("QR 交換トークン", () => {
    beforeEach(() => {
      signInAs(USER_A);
    });

    it("GET /me/friends/qr-token: 認証ユーザー紐づきのトークンを発行する", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friends/qr-token",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        token: string;
        expiresAt: number;
      };
      expect(body.token.split(".")).toHaveLength(2);
      expect(body.expiresAt).toBeGreaterThan(Date.now() / 1000);

      // 発行したトークンは即時成立に使える（USER_A が QR を出した想定で
      // USER_B がスキャンしたケースを再現する）。
      signInAs(USER_B);
      const post = await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_A, qrToken: body.token }),
        },
        TEST_BINDINGS,
      );
      expect(post.status).toBe(201);
    });

    it("POST /me/friends: qrToken 無しは 403（qr_exchange_required）", async () => {
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

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });

    it("POST /me/friends: 改ざん・他人宛のトークンは 403", async () => {
      const app = buildApp();
      // USER_A 宛に発行したトークンを USER_B 宛に使い回すケース
      const othersToken = await qrTokenFor(USER_A);
      const res = await postFriend(app, USER_B, {
        qrToken: `${othersToken}x`,
      });
      expect(res.status).toBe(403);

      const res2 = await postFriend(app, USER_B, {
        qrToken: await qrTokenFor(USER_A),
      });
      expect(res2.status).toBe(403);
    });

    it("POST /me/friends: 期限切れトークンは 403", async () => {
      const app = buildApp();
      const res = await postFriend(app, USER_B, {
        qrToken: await qrTokenFor(USER_B, -(QR_EXCHANGE_TOKEN_TTL_SEC + 60)),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("qr_exchange_required");
    });
  });
});
