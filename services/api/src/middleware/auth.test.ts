import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { signJwt, verifyJwt } from "@clerk/backend/jwt";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { deletedUsers, users } from "@/db/schema";

// clerkMiddleware に渡した options を捕捉するため、呼び出し引数を記録する。
const clerkMiddlewareArgs = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  // 本番 @clerk/hono の挙動を再現するためのモード。
  // "next"    : clerk をセットして next を呼ぶ（通常経路）
  // "handshake": next を呼ばず Response を返す（clerkAuth 未設定になる）
  // "throw"   : authenticateRequest 相当の例外を投げる
  behavior: "next" as "next" | "handshake" | "throw",
}));
const clerkUsers = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: (options: Record<string, unknown>) => {
    clerkMiddlewareArgs.calls.push(options);
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      if (clerkMiddlewareArgs.behavior === "handshake") {
        // 本番同様、next を呼ばず handshake のリダイレクト応答を返す。
        return new Response(null, { status: 307 });
      }
      if (clerkMiddlewareArgs.behavior === "throw") {
        throw new Error("Clerk: authenticateRequest failed");
      }
      c.set("clerk", { users: clerkUsers });
      await next();
    };
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_mw001";

type TestEnv = {
  Bindings: {
    DB: D1Database;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    CLERK_AUTHORIZED_PARTIES?: string;
  };
  Variables: {
    clerkUserId?: string;
  };
};

function buildApp() {
  const app = applyApiErrorHandling(new Hono<TestEnv>());
  app.use("/protected/*", requireAuth);
  app.get("/protected/ping", (c) => c.json({ ok: true }));
  app.use("/public/*", optionalAuth);
  app.get("/public/ping", (c) =>
    c.json({ viewer: c.get("clerkUserId") ?? null }),
  );
  return app;
}

const testBindings = (extra: Record<string, string> = {}) => ({
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
  ...extra,
});

function signInAs(userId: string | null, sessionClaims?: { iat?: number }) {
  vi.mocked(getAuth).mockReturnValue(
    (userId
      ? { userId, sessionClaims: sessionClaims ?? null }
      : null) as ReturnType<typeof getAuth>,
  );
}

describe("認証ミドルウェア", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    clerkMiddlewareArgs.calls.length = 0;
    clerkMiddlewareArgs.behavior = "next";
    vi.mocked(getAuth).mockReset();
    clerkUsers.getUser.mockReset();
    clerkUsers.getUser.mockResolvedValue({
      username: null,
      firstName: null,
      lastName: null,
    });
  });

  describe("authorizedParties（azp 検証）", () => {
    it("CLERK_AUTHORIZED_PARTIES をカンマ区切りでパースして clerkMiddleware に渡す", async () => {
      signInAs(USER_ID);
      const app = buildApp();
      await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings({
          CLERK_AUTHORIZED_PARTIES:
            "https://animeishi.uomi.dev, https://animeishi-web-production.uozumi05.workers.dev",
        }),
      );

      expect(clerkMiddlewareArgs.calls).toHaveLength(1);
      expect(clerkMiddlewareArgs.calls[0]?.authorizedParties).toEqual([
        "https://animeishi.uomi.dev",
        "https://animeishi-web-production.uozumi05.workers.dev",
      ]);
    });

    it("optionalAuth でも同じ authorizedParties を渡す", async () => {
      signInAs(null);
      const app = buildApp();
      await app.request(
        "/public/ping",
        {
          method: "GET",
          // optionalAuth は Bearer トークンが無いと Clerk を呼ばないため
          // このテストでは認証ヘッダを付けて middleware まで到達させる。
          headers: { Authorization: "Bearer test-token" },
        },
        testBindings({
          CLERK_AUTHORIZED_PARTIES: "https://animeishi.uomi.dev",
        }),
      );

      expect(clerkMiddlewareArgs.calls[0]?.authorizedParties).toEqual([
        "https://animeishi.uomi.dev",
      ]);
    });

    it("CLERK_AUTHORIZED_PARTIES 未設定なら authorizedParties を渡さない（azp 検証しない）", async () => {
      signInAs(USER_ID);
      const app = buildApp();
      await app.request("/protected/ping", { method: "GET" }, testBindings());

      expect(clerkMiddlewareArgs.calls[0]?.authorizedParties).toBeUndefined();
    });
  });

  describe("ネイティブアプリのトークン（azp なし）", () => {
    // Clerk の azp 検証は「azp クレームが存在する場合のみ」照合する。
    // ネイティブアプリのトークンには azp が無いため、authorizedParties を
    // 設定しても検証を通過する。この契約を実際の @clerk/backend の
    // signJwt / verifyJwt で担保する。
    async function issueToken(payload: Record<string, unknown>) {
      const { privateKey, publicKey } = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );
      const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
      const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
      const now = Math.floor(Date.now() / 1000);
      // signJwt は withLegacyReturn 経由で署名済みトークン文字列を直接返す。
      const token = await signJwt(
        { sub: USER_ID, iat: now, exp: now + 300, ...payload },
        privateJwk,
        { algorithm: "RS256" },
      );
      return { token, publicJwk };
    }

    const AUTHORIZED_PARTIES = ["https://animeishi.uomi.dev"];

    it("azp クレームの無いトークンは authorizedParties 指定でも検証を通過する", async () => {
      const { token, publicJwk } = await issueToken({});
      const payload = await verifyJwt(token, {
        key: publicJwk,
        authorizedParties: AUTHORIZED_PARTIES,
      });
      expect(payload.sub).toBe(USER_ID);
    });

    it("許可された azp のトークンは検証を通過する", async () => {
      const { token, publicJwk } = await issueToken({
        azp: "https://animeishi.uomi.dev",
      });
      await expect(
        verifyJwt(token, {
          key: publicJwk,
          authorizedParties: AUTHORIZED_PARTIES,
        }),
      ).resolves.toBeDefined();
    });

    it("許可されていない azp のトークンは検証に失敗する", async () => {
      const { token, publicJwk } = await issueToken({
        azp: "https://evil.example.com",
      });
      await expect(
        verifyJwt(token, {
          key: publicJwk,
          authorizedParties: AUTHORIZED_PARTIES,
        }),
      ).rejects.toThrow();
    });

    it("azp なしでもミドルウェアは 401 を返さない", async () => {
      // getAuth が userId を返す = Clerk 側の検証を通過した状態。
      // ネイティブアプリ（azp なし）も同じ経路を通るため 401 にならない。
      signInAs(USER_ID);
      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings({
          CLERK_AUTHORIZED_PARTIES: "https://animeishi.uomi.dev",
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("requireAuth", () => {
    it("clerkMiddleware が handshake 応答を返したら 401 を返す", async () => {
      // Accept: text/html のドキュメント取得などで Clerk が handshake を
      // 返すと auth が未設定のままになる。以前は getAuth が throw して
      // 500 になっていた（issue #154）。
      clerkMiddlewareArgs.behavior = "handshake";
      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );
      expect(res.status).toBe(401);
    });

    it("clerkMiddleware が例外を投げても 401 を返す", async () => {
      clerkMiddlewareArgs.behavior = "throw";
      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer invalid-token" },
        },
        testBindings(),
      );
      expect(res.status).toBe(401);
    });

    it("getAuth が例外を投げても 401 を返す", async () => {
      vi.mocked(getAuth).mockImplementation(() => {
        throw new Error(
          "Clerk: getAuth() called without clerkMiddleware() being applied.",
        );
      });
      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer invalid-token" },
        },
        testBindings(),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("削除済みユーザー（issue #144）", () => {
    let db: Awaited<ReturnType<typeof setupTestDb>>;

    beforeEach(async () => {
      db = await setupTestDb(env.DB);
    });

    it("削除前に発行された JWT（iat <= deleted_at）は 401 で users 行が再作成されない", async () => {
      const deletedAt = new Date();
      await db.insert(deletedUsers).values({ userId: USER_ID, deletedAt });
      // 削除前に発行された短命 JWT がまだ有効な状態を再現する。
      signInAs(USER_ID, { iat: Math.floor(deletedAt.getTime() / 1000) - 60 });

      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );

      expect(res.status).toBe(401);
      // users 行は再作成されず、tombstone も残ったままであること。
      expect(
        await db.select().from(users).where(eq(users.id, USER_ID)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(deletedUsers)
          .where(eq(deletedUsers.userId, USER_ID)),
      ).toHaveLength(1);
    });

    it("iat を持たないトークンは削除済み扱いで 401 を返す", async () => {
      await db
        .insert(deletedUsers)
        .values({ userId: USER_ID, deletedAt: new Date() });
      signInAs(USER_ID); // sessionClaims なし = iat 不明

      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );

      expect(res.status).toBe(401);
      expect(
        await db.select().from(users).where(eq(users.id, USER_ID)),
      ).toHaveLength(0);
    });

    it("削除後に発行された JWT（iat > deleted_at）は tombstone を解除して通す", async () => {
      // Clerk deleteUser が失敗したケース: D1 側は削除済みだが Clerk 側では
      // ユーザーが生存しており、削除時刻より新しいトークンを持っている。
      const deletedAt = new Date(Date.now() - 60_000);
      await db.insert(deletedUsers).values({ userId: USER_ID, deletedAt });
      // iat は秒・deleted_at はミリ秒。切り捨て誤差を避けるため明示的に
      // 削除時刻より後の値にする。
      signInAs(USER_ID, {
        iat: Math.floor(deletedAt.getTime() / 1000) + 60,
      });

      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );

      expect(res.status).toBe(200);
      // tombstone が解除され、通常どおり users 行が再プロビジョニングされる。
      expect(
        await db
          .select()
          .from(deletedUsers)
          .where(eq(deletedUsers.userId, USER_ID)),
      ).toHaveLength(0);
      expect(
        await db.select().from(users).where(eq(users.id, USER_ID)),
      ).toHaveLength(1);
    });

    it("users 行が無く Clerk getUser が 404 を返す場合も 401 で再作成しない", async () => {
      // tombstone を伴わない削除（運用での手動削除など）でも、Clerk 側の
      // 404 を根拠にプロビジョニングを中止する。
      clerkUsers.getUser.mockRejectedValue(
        new ClerkAPIResponseError("not found", {
          data: [],
          status: 404,
          clerkTraceId: "trace_test",
        }),
      );
      signInAs(USER_ID);

      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );

      expect(res.status).toBe(401);
      expect(
        await db.select().from(users).where(eq(users.id, USER_ID)),
      ).toHaveLength(0);
    });

    it("Clerk getUser が 404 以外で失敗しても従来どおりプロビジョニングする", async () => {
      // 一時的な障害（ネットワーク・5xx）はプロビジョニングを止めず、
      // userId を表示名にフォールバックして作成する。
      clerkUsers.getUser.mockRejectedValue(
        new ClerkAPIResponseError("unavailable", {
          data: [],
          status: 500,
          clerkTraceId: "trace_test",
        }),
      );
      signInAs(USER_ID);

      const app = buildApp();
      const res = await app.request(
        "/protected/ping",
        { method: "GET" },
        testBindings(),
      );

      expect(res.status).toBe(200);
      const created = await db
        .select()
        .from(users)
        .where(eq(users.id, USER_ID));
      expect(created).toHaveLength(1);
      expect(created[0]?.username).toBe(USER_ID);
    });
  });

  describe("optionalAuth", () => {
    it("未認証でも匿名として通過する", async () => {
      signInAs(null);
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer test-token" },
        },
        testBindings({
          CLERK_AUTHORIZED_PARTIES: "https://animeishi.uomi.dev",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
    });

    it("Authorization ヘッダが無ければ Clerk を呼ばず匿名として通過する", async () => {
      // クローラーやブラウザのドキュメント取得は Bearer を持たない。
      // Clerk を呼ぶと handshake で getAuth が throw するため、
      // そもそも呼ばないことで防ぐ（issue #154）。
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        { method: "GET", headers: { Accept: "text/html" } },
        testBindings(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
      expect(clerkMiddlewareArgs.calls).toHaveLength(0);
    });

    it("clerkMiddleware が handshake 応答を返しても匿名として通過する", async () => {
      clerkMiddlewareArgs.behavior = "handshake";
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer test-token" },
        },
        testBindings(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
    });

    it("clerkMiddleware が例外を投げても匿名として通過する", async () => {
      clerkMiddlewareArgs.behavior = "throw";
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer invalid-token" },
        },
        testBindings(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
    });

    it("getAuth が例外を投げても匿名として通過する", async () => {
      vi.mocked(getAuth).mockImplementation(() => {
        throw new Error(
          "Clerk: getAuth() called without clerkMiddleware() being applied.",
        );
      });
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        {
          method: "GET",
          headers: { Authorization: "Bearer invalid-token" },
        },
        testBindings(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
    });
  });
});
