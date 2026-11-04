import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "../../test-utils/setup-db";
import { applyApiErrorHandling } from "../../test-utils/apiApp";
import { friendRequests } from "@/features/friend-requests";
import { users, friends, blocks } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_A = "user_reqA001";
const USER_B = "user_reqB002";
const USER_C = "user_reqC003";

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
  app.route("/me/friend-requests", friendRequests);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

const postRequest = (app: ReturnType<typeof buildApp>, userId: string) =>
  app.request(
    "/me/friend-requests",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    },
    TEST_BINDINGS,
  );

type RequestItem = { id: number; userId: string; username: string };
type RequestList = { received: RequestItem[]; sent: RequestItem[] };

async function listRequests(
  app: ReturnType<typeof buildApp>,
): Promise<RequestList> {
  const res = await app.request(
    "/me/friend-requests",
    { method: "GET" },
    TEST_BINDINGS,
  );
  return (await res.json()) as RequestList;
}

describe("フレンド申請 API", () => {
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
      {
        id: USER_C,
        username: "ユーザーC",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  describe("認証なし", () => {
    it("GET /me/friend-requests: 401 を返す", async () => {
      vi.mocked(getAuth).mockReturnValue(
        null as unknown as ReturnType<typeof getAuth>,
      );

      const app = buildApp();
      const res = await app.request(
        "/me/friend-requests",
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

    it("GET /me/friend-requests: 初期状態は received/sent とも空", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friend-requests",
        { method: "GET" },
        TEST_BINDINGS,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as RequestList;
      expect(body).toEqual({ received: [], sent: [] });
    });

    it("POST /me/friend-requests: 申請を送れる（pending）", async () => {
      const app = buildApp();
      const res = await postRequest(app, USER_B);

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        status: string;
        request: { requesterId: string; addresseeId: string } | null;
      };
      expect(body.status).toBe("pending");
      expect(body.request?.requesterId).toBe(USER_A);
      expect(body.request?.addresseeId).toBe(USER_B);
    });

    it("送った申請は sent に、相手側では received に現れる", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);

      const mine = await listRequests(app);
      expect(mine.sent).toHaveLength(1);
      expect(mine.sent[0]?.userId).toBe(USER_B);
      expect(mine.sent[0]?.username).toBe("ユーザーB");
      expect(mine.received).toHaveLength(0);

      signInAs(USER_B);
      const theirs = await listRequests(app);
      expect(theirs.received).toHaveLength(1);
      expect(theirs.received[0]?.userId).toBe(USER_A);
      expect(theirs.received[0]?.username).toBe("ユーザーA");
      expect(theirs.sent).toHaveLength(0);
    });

    it("POST /me/friend-requests: 同じ相手への重複申請は冪等", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);
      const res = await postRequest(app, USER_B);
      expect(res.status).toBe(201);

      const list = await listRequests(app);
      expect(list.sent).toHaveLength(1);
    });

    it("POST /me/friend-requests: 自分自身への申請は 400", async () => {
      const app = buildApp();
      const res = await postRequest(app, USER_A);
      expect(res.status).toBe(400);
    });

    it("POST /me/friend-requests: 存在しないユーザーは 404", async () => {
      const app = buildApp();
      const res = await postRequest(app, "user_nonexistent");
      expect(res.status).toBe(404);
    });

    it("POST /me/friend-requests: すでにフレンドの相手は 409", async () => {
      const now = new Date();
      await db.insert(friends).values([
        { userId: USER_A, friendId: USER_B, createdAt: now },
        { userId: USER_B, friendId: USER_A, createdAt: now },
      ]);

      const app = buildApp();
      const res = await postRequest(app, USER_B);
      expect(res.status).toBe(409);
    });

    it("POST /me/friend-requests: ブロック関係にある相手は 403", async () => {
      await db.insert(blocks).values({
        blockerId: USER_B,
        blockedId: USER_A,
        createdAt: new Date(),
      });

      const app = buildApp();
      const res = await postRequest(app, USER_B);
      expect(res.status).toBe(403);
    });

    it("POST /me/friend-requests: 相手からの申請済みなら即フレンド成立（accepted）", async () => {
      const app = buildApp();
      // B → A の申請を先に作る
      signInAs(USER_B);
      await postRequest(app, USER_A);

      // A → B の申請は相互意思として即成立
      signInAs(USER_A);
      const res = await postRequest(app, USER_B);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("accepted");

      // 申請行は両方向とも消え、双方向にフレンドが登録される
      const list = await listRequests(app);
      expect(list.received).toHaveLength(0);
      expect(list.sent).toHaveLength(0);
      const friendRows = await db.query.friends.findMany();
      expect(friendRows).toHaveLength(2);
    });

    it("POST /{id}/accept: 受信者が承認すると双方向フレンドになり申請は消える", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);

      signInAs(USER_B);
      const list = await listRequests(app);
      const requestId = list.received[0]!.id;

      const res = await app.request(
        `/me/friend-requests/${requestId}/accept`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const friendRows = await db.query.friends.findMany();
      expect(friendRows).toHaveLength(2);
      const after = await listRequests(app);
      expect(after.received).toHaveLength(0);
    });

    it("POST /{id}/accept: 送信者は自分の申請を承認できない（404）", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);
      const list = await listRequests(app);
      const requestId = list.sent[0]!.id;

      const res = await app.request(
        `/me/friend-requests/${requestId}/accept`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("POST /{id}/accept: 存在しない申請は 404", async () => {
      const app = buildApp();
      const res = await app.request(
        "/me/friend-requests/999/accept",
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("DELETE /{id}: 受信者が拒否すると申請が消える", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);

      signInAs(USER_B);
      const list = await listRequests(app);
      const res = await app.request(
        `/me/friend-requests/${list.received[0]!.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const after = await listRequests(app);
      expect(after.received).toHaveLength(0);
    });

    it("DELETE /{id}: 送信者が取り消せる", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);
      const list = await listRequests(app);

      const res = await app.request(
        `/me/friend-requests/${list.sent[0]!.id}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const after = await listRequests(app);
      expect(after.sent).toHaveLength(0);
    });

    it("DELETE /{id}: 当事者でないユーザーは削除できない（404）", async () => {
      const app = buildApp();
      await postRequest(app, USER_B);
      const requestId = (await listRequests(app)).sent[0]!.id;

      signInAs(USER_C);
      const res = await app.request(
        `/me/friend-requests/${requestId}`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });
});
