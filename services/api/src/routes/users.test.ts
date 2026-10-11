import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { friends } from "@/routes/friends";
import { avatar, me } from "@/routes/me";
import { user } from "@/routes/user";
import { usersRoute } from "@/routes/users";
import { friends as friendsTable, reports, users } from "@/db/schema";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

// notifyUserReport が scope に載せる fingerprint / タグを検証するため、
// withScope に渡す scope を共通化して spy する。
const sentryScope = vi.hoisted(() => ({
  setTag: vi.fn(),
  setContext: vi.fn(),
  setFingerprint: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
  withScope: (fn: (scope: unknown) => void) => fn(sentryScope),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import { getAuth } from "@clerk/hono";
import { captureMessage } from "@sentry/cloudflare";

const USER_A = "user_modA001";
const USER_B = "user_modB002";
const USER_C = "user_modC003";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    AVATARS: R2Bucket;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
  };
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
  app.route("/me", avatar);
  app.route("/me", me);
  app.route("/me/friends", friends);
  app.route("/user", user);
  return app;
}

function signInAs(userId: string) {
  vi.mocked(getAuth).mockReturnValue({
    userId,
  } as ReturnType<typeof getAuth>);
}

function signOut() {
  vi.mocked(getAuth).mockReturnValue(
    null as unknown as ReturnType<typeof getAuth>,
  );
}

describe("ユーザー通報・ブロック API", () => {
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
      {
        id: USER_C,
        username: "ユーザーC",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  describe("POST /users/:id/report", () => {
    it("認証なしは 401", async () => {
      signOut();
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "不適切なコンテンツ" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("通報を作成でき、運営通知が Sentry に送られる", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "不適切なコンテンツ" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(201);

      const rows = await db
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.reporterId, USER_A),
            eq(reports.reportedUserId, USER_B),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe("不適切なコンテンツ");
      // 運営通知: 通報対象ユーザーごとに Issue が分かれるよう fingerprint で
      // 区別し、report.reported_user_id タグで検索可能にする
      expect(vi.mocked(captureMessage)).toHaveBeenCalledWith(
        "user_report_received",
        "warning",
      );
      expect(sentryScope.setFingerprint).toHaveBeenCalledWith([
        "user_report",
        USER_B,
      ]);
      expect(sentryScope.setTag).toHaveBeenCalledWith(
        "report.reported_user_id",
        USER_B,
      );
    });

    it("自分自身は通報できない（400）", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_A}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "test" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("存在しないユーザーは 404", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        "/users/user_notexist/report",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "test" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("reason が空なら 400", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "" }),
        },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /users/:id/block", () => {
    it("認証なしは 401", async () => {
      signOut();
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(401);
    });

    it("ブロックでき、GET /me/blocks に現れる", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const listRes = await app.request(
        "/me/blocks",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as {
        blockedId: string;
        username: string;
      }[];
      expect(list).toHaveLength(1);
      expect(list[0].blockedId).toBe(USER_B);
      expect(list[0].username).toBe("ユーザーB");
    });

    it("二重ブロックしても冪等（200・一覧は1件）", async () => {
      signInAs(USER_A);
      const app = buildApp();
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const listRes = await app.request(
        "/me/blocks",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await listRes.json()) as unknown[]).toHaveLength(1);
    });

    it("自分自身はブロックできない（400）", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_A}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(400);
    });

    it("存在しないユーザーは 404", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        "/users/user_notexist/block",
        { method: "POST" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /users/:id/block", () => {
    it("ブロックを解除できる", async () => {
      signInAs(USER_A);
      const app = buildApp();
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);

      const listRes = await app.request(
        "/me/blocks",
        { method: "GET" },
        TEST_BINDINGS,
      );
      expect((await listRes.json()) as unknown[]).toHaveLength(0);
    });

    it("ブロックしていなくても 200（冪等）", async () => {
      signInAs(USER_A);
      const app = buildApp();
      const res = await app.request(
        `/users/${USER_B}/block`,
        { method: "DELETE" },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
    });
  });

  describe("ブロックの効果", () => {
    async function makeFriends(app: ReturnType<typeof buildApp>) {
      signInAs(USER_A);
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );
    }

    it("ブロックすると既存のフレンド関係が双方向で解消される", async () => {
      const app = buildApp();
      await makeFriends(app);

      signInAs(USER_A);
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      const remaining = await db.select().from(friendsTable);
      expect(remaining).toHaveLength(0);
    });

    it("ブロックした相手はフレンド一覧から除外される（双方向）", async () => {
      const app = buildApp();
      // A と C をフレンドにしておき、B はフレンドでない第三者として用意する
      signInAs(USER_A);
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_B }),
        },
        TEST_BINDINGS,
      );
      await app.request(
        "/me/friends",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendId: USER_C }),
        },
        TEST_BINDINGS,
      );

      // A が B をブロックしても、B 側のフレンド一覧に A は残る
      // （ブロックでフレンド行は消える設計。逆方向を担保するため先に確認）
      signInAs(USER_C);
      await app.request(
        `/users/${USER_A}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      // C が A をブロック → C の一覧からも A の一覧からも C は消える
      signInAs(USER_C);
      const resC = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyC = (await resC.json()) as { friendId: string }[];
      expect(bodyC.map((f) => f.friendId)).not.toContain(USER_A);

      signInAs(USER_A);
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyA = (await resA.json()) as { friendId: string }[];
      expect(bodyA.map((f) => f.friendId)).not.toContain(USER_C);
      expect(bodyA.map((f) => f.friendId)).toContain(USER_B);
    });

    it("相手にブロックされている側のフレンド一覧からも除外される", async () => {
      const app = buildApp();
      // A と C のフレンド関係はあるが C が A をブロックした状態を作るため
      // friends テーブルへ直接挿入する（ブロック時の自動解除を迂回する）。
      await db.insert(friendsTable).values([
        { userId: USER_A, friendId: USER_C, createdAt: new Date() },
        { userId: USER_C, friendId: USER_A, createdAt: new Date() },
      ]);

      signInAs(USER_C);
      // blocks テーブルにだけブロック行を足す（friend 行は残す）
      await app.request(
        `/users/${USER_A}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );
      // block 時に friend 行は消えるため再挿入して「ブロック済みなのに
      // friend 行が残る」状態を作り、一覧のフィルタが効くことを検証する。
      await db.insert(friendsTable).values([
        { userId: USER_A, friendId: USER_C, createdAt: new Date() },
        { userId: USER_C, friendId: USER_A, createdAt: new Date() },
      ]);

      signInAs(USER_A);
      const resA = await app.request(
        "/me/friends",
        { method: "GET" },
        TEST_BINDINGS,
      );
      const bodyA = (await resA.json()) as { friendId: string }[];
      expect(bodyA.map((f) => f.friendId)).not.toContain(USER_C);
    });

    it("ブロック中の相手はフレンド追加できない（403）", async () => {
      const app = buildApp();
      signInAs(USER_A);
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

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
    });

    it("自分をブロックしている相手もフレンド追加できない（403）", async () => {
      const app = buildApp();
      signInAs(USER_B);
      await app.request(
        `/users/${USER_A}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      signInAs(USER_A);
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
    });

    it("ブロックした相手の名刺は閲覧できない（404）", async () => {
      const app = buildApp();
      signInAs(USER_A);
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      const res = await app.request(
        `/user/${USER_B}`,
        { method: "GET", headers: { Accept: "application/json" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("自分をブロックした相手の名刺も閲覧できない（404）", async () => {
      const app = buildApp();
      signInAs(USER_B);
      await app.request(
        `/users/${USER_A}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      signInAs(USER_A);
      const res = await app.request(
        `/user/${USER_B}`,
        { method: "GET", headers: { Accept: "application/json" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(404);
    });

    it("未認証の公開名刺閲覧には影響しない（公開URLのため）", async () => {
      const app = buildApp();
      signInAs(USER_A);
      await app.request(
        `/users/${USER_B}/block`,
        { method: "POST" },
        TEST_BINDINGS,
      );

      signOut();
      const res = await app.request(
        `/user/${USER_B}`,
        { method: "GET", headers: { Accept: "application/json" } },
        TEST_BINDINGS,
      );
      expect(res.status).toBe(200);
    });
  });
});
