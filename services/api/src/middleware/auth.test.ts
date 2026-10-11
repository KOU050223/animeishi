import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { signJwt, verifyJwt } from "@clerk/backend/jwt";
import { setupTestDb } from "../test-utils/setup-db";
import { applyApiErrorHandling } from "../test-utils/apiApp";
import { requireAuth, optionalAuth } from "@/middleware/auth";

// clerkMiddleware に渡した options を捕捉するため、呼び出し引数を記録する。
const clerkMiddlewareArgs = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
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

function signInAs(userId: string | null) {
  vi.mocked(getAuth).mockReturnValue(
    (userId ? { userId } : null) as ReturnType<typeof getAuth>,
  );
}

describe("認証ミドルウェア", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    clerkMiddlewareArgs.calls.length = 0;
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
        { method: "GET" },
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

  describe("optionalAuth", () => {
    it("未認証でも匿名として通過する", async () => {
      signInAs(null);
      const app = buildApp();
      const res = await app.request(
        "/public/ping",
        { method: "GET" },
        testBindings({
          CLERK_AUTHORIZED_PARTIES: "https://animeishi.uomi.dev",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ viewer: null });
    });
  });
});
