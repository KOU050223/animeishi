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

    describe("レート制限・重複抑止（issue #148）", () => {
      // 同一対象: 24h に 1 回 / 全体: 1h に 10 件（実装側の定数と同値）
      const HOURLY_LIMIT = 10;

      const reportTarget = (
        app: ReturnType<typeof buildApp>,
        targetId: string,
      ) =>
        app.request(
          `/users/${targetId}/report`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "不適切なコンテンツ" }),
          },
          TEST_BINDINGS,
        );

      it("同一ユーザーへの再通報は 24 時間以内だと 429 + Retry-After", async () => {
        signInAs(USER_A);
        const app = buildApp();
        expect((await reportTarget(app, USER_B)).status).toBe(201);

        const res = await reportTarget(app, USER_B);
        expect(res.status).toBe(429);
        expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe("duplicate_target");

        // 拒否された分は記録されず、運営通知も重複して飛ばない
        expect(await db.select().from(reports)).toHaveLength(1);
        expect(vi.mocked(captureMessage)).toHaveBeenCalledTimes(1);
      });

      it("24 時間経過すれば同一ユーザーへ再通報できる", async () => {
        signInAs(USER_A);
        const app = buildApp();
        await db.insert(reports).values({
          reporterId: USER_A,
          reportedUserId: USER_B,
          reason: "過去の通報",
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        });

        expect((await reportTarget(app, USER_B)).status).toBe(201);
      });

      it("重複抑止は対象ユーザーごと（別ユーザーへの通報は通る）", async () => {
        signInAs(USER_A);
        const app = buildApp();
        expect((await reportTarget(app, USER_B)).status).toBe(201);
        expect((await reportTarget(app, USER_C)).status).toBe(201);
      });

      it("1 時間の通報上限を超えると 429", async () => {
        signInAs(USER_A);
        const app = buildApp();
        const now = new Date();
        const targets = Array.from(
          { length: HOURLY_LIMIT + 1 },
          (_, i) => `user_target${i}`,
        );
        await db.insert(users).values(
          targets.map((id) => ({
            id,
            username: id,
            isPublic: true,
            createdAt: now,
            updatedAt: now,
          })),
        );
        for (const target of targets.slice(0, HOURLY_LIMIT)) {
          expect((await reportTarget(app, target)).status).toBe(201);
        }

        const res = await reportTarget(app, targets[HOURLY_LIMIT]);
        expect(res.status).toBe(429);
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe("hourly_limit");
      });

      it("上限カウントは直近 1 時間のみ（古い通報は含まない）", async () => {
        signInAs(USER_A);
        const app = buildApp();
        const old = new Date(Date.now() - 61 * 60 * 1000);
        await db.insert(reports).values(
          Array.from({ length: HOURLY_LIMIT }, () => ({
            reporterId: USER_A,
            reportedUserId: USER_B,
            reason: "過去の通報",
            createdAt: old,
          })),
        );

        expect((await reportTarget(app, USER_C)).status).toBe(201);
      });

      it("窓内の通報が上限超過でも Retry-After は挿入可能な時刻を指す", async () => {
        signInAs(USER_A);
        const app = buildApp();
        // 制限導入前のデータなどで直近 1h に LIMIT+1 件残っている場合、
        // 最古 1 件の失効後もまだ上限超過のまま。Retry-After は新しい順
        // LIMIT 件目（= 2 番目に古い行）の失効時刻を指すべき。
        const now = Date.now();
        await db.insert(reports).values(
          Array.from({ length: HOURLY_LIMIT + 1 }, (_, i) => ({
            reporterId: USER_A,
            reportedUserId: USER_B,
            reason: "過去の通報",
            // 最古が 55 分前、以後 5 分刻み（すべて 1h 窓内）
            createdAt: new Date(now - (HOURLY_LIMIT + 1 - i) * 300 * 1000),
          })),
        );

        const res = await reportTarget(app, USER_C);
        expect(res.status).toBe(429);
        // 最古行の失効（残り約 300s）ではなく 2 番目に古い行の失効
        // （残り約 600s）を指すこと。処理時間・秒精度を考慮して幅を持たせる。
        const retryAfter = Number(res.headers.get("Retry-After"));
        expect(retryAfter).toBeGreaterThan(550);
        expect(retryAfter).toBeLessThan(650);
      });

      it("上限カウントは通報者ごと（他人の通報は含まない）", async () => {
        signInAs(USER_A);
        const app = buildApp();
        const now = new Date();
        await db.insert(reports).values(
          Array.from({ length: HOURLY_LIMIT }, () => ({
            reporterId: USER_B,
            reportedUserId: USER_C,
            reason: "他人の通報",
            createdAt: now,
          })),
        );

        expect((await reportTarget(app, USER_B)).status).toBe(201);
      });
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

      // ログイン済みの閲覧者として扱われるには Authorization: Bearer が必要
      // （optionalAuth は Bearer 無しでは匿名として素通りする）。
      const res = await app.request(
        `/user/${USER_B}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer test-token",
          },
        },
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
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer test-token",
          },
        },
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
