import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupTestDb } from "./helpers/setup-db";
import { annict } from "@/routes/annict";
import { users, annictTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ANNICT_TOKEN_ENDPOINT,
  ANNICT_TOKEN_INFO_ENDPOINT,
} from "@/lib/annict/client";

vi.mock("@clerk/hono", () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuth: vi.fn(),
}));

import { getAuth } from "@clerk/hono";

const USER_ID = "user_annict001";
// 32byte base64 の暗号鍵をテスト実行時に生成する（固定値の埋め込みはシークレット
// スキャンの誤検知を招くため）。
const ENC_KEY = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

const TEST_BINDINGS = {
  DB: env.DB,
  CLERK_SECRET_KEY: "test_secret",
  CLERK_PUBLISHABLE_KEY: "test_pub",
  ANNICT_CLIENT_ID: "test_client_id",
  ANNICT_CLIENT_SECRET: "test_client_secret",
  ANNICT_ENCRYPTION_KEY: ENC_KEY,
};

type TestEnv = {
  Bindings: typeof TEST_BINDINGS;
  Variables: { clerkUserId: string };
};

function buildApp() {
  const app = new Hono<TestEnv>();
  app.route("/me/annict", annict);
  return app;
}

// Annict の token / token-info エンドポイントを fetch モックする。
function mockAnnictFetch(opts: {
  accessToken?: string;
  scope?: string;
  ownerId?: number;
  tokenInfoStatus?: number;
}) {
  const {
    accessToken = "annict_tok_web",
    scope = "read write",
    ownerId = 42,
    tokenInfoStatus = 200,
  } = opts;
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === ANNICT_TOKEN_ENDPOINT) {
      return new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          scope,
          created_at: 1700000000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === ANNICT_TOKEN_INFO_ENDPOINT) {
      if (tokenInfoStatus !== 200) {
        return new Response("unauthorized", { status: tokenInfoStatus });
      }
      return new Response(
        JSON.stringify({
          resource_owner_id: ownerId,
          scope: scope.split(" "),
          expires_in: null,
          created_at: 1700000000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("Annict ルート (Web 連携)", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    vi.mocked(getAuth).mockReset();
    vi.mocked(getAuth).mockReturnValue({
      userId: USER_ID,
    } as unknown as ReturnType<typeof getAuth>);

    const now = new Date();
    await db.insert(users).values({
      id: USER_ID,
      username: "テストユーザー",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POST /exchange (mode:web): トークンを D1 に暗号化保存し、ボディにトークンを含めない", async () => {
    globalThis.fetch = mockAnnictFetch({
      accessToken: "annict_tok_secret",
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.request(
      "/me/annict/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "auth_code",
          redirectUri: "https://animeishi.uomi.dev/annict",
          mode: "web",
        }),
      },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      connected: true,
      scope: "read write",
      annictUserId: 42,
    });
    // ボディに生トークンを含めない。
    expect(JSON.stringify(body)).not.toContain("annict_tok_secret");

    // D1 に暗号化保存されている（平文ではない）。
    const row = await db.query.annictTokens.findFirst({
      where: eq(annictTokens.userId, USER_ID),
    });
    expect(row).toBeTruthy();
    expect(row!.encryptedToken).not.toContain("annict_tok_secret");
    expect(row!.annictUserId).toBe(42);
  });

  it("POST /exchange (mode:web) 後に GET / が connected:true を返す", async () => {
    globalThis.fetch = mockAnnictFetch({}) as unknown as typeof fetch;
    const app = buildApp();

    await app.request(
      "/me/annict/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "auth_code",
          redirectUri: "https://animeishi.uomi.dev/annict",
          mode: "web",
        }),
      },
      TEST_BINDINGS,
    );

    const res = await app.request("/me/annict", {}, TEST_BINDINGS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.connected).toBe(true);
    expect(body.annictUserId).toBe(42);
  });

  it("POST /exchange (mode:native): 従来通りトークンをボディで返す", async () => {
    globalThis.fetch = mockAnnictFetch({
      accessToken: "native_tok",
    }) as unknown as typeof fetch;
    const app = buildApp();

    const res = await app.request(
      "/me/annict/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "auth_code",
          redirectUri: "animeishi://annict",
          mode: "native",
        }),
      },
      TEST_BINDINGS,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.accessToken).toBe("native_tok");
    // native では D1 に保存しない。
    const row = await db.query.annictTokens.findFirst({
      where: eq(annictTokens.userId, USER_ID),
    });
    expect(row).toBeUndefined();
  });

  it("POST /disconnect: D1 のトークンを削除し connected:false を返す", async () => {
    globalThis.fetch = mockAnnictFetch({}) as unknown as typeof fetch;
    const app = buildApp();
    // まず連携する。
    await app.request(
      "/me/annict/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "auth_code",
          redirectUri: "https://animeishi.uomi.dev/annict",
          mode: "web",
        }),
      },
      TEST_BINDINGS,
    );

    const res = await app.request(
      "/me/annict/disconnect",
      { method: "POST" },
      TEST_BINDINGS,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });

    const row = await db.query.annictTokens.findFirst({
      where: eq(annictTokens.userId, USER_ID),
    });
    expect(row).toBeUndefined();
  });

  it("mode:web だが暗号鍵未設定: 500 を返す", async () => {
    globalThis.fetch = mockAnnictFetch({}) as unknown as typeof fetch;
    const app = buildApp();
    const noKeyBindings = {
      ...TEST_BINDINGS,
      ANNICT_ENCRYPTION_KEY: undefined,
    };

    const res = await app.request(
      "/me/annict/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "auth_code",
          redirectUri: "https://animeishi.uomi.dev/annict",
          mode: "web",
        }),
      },
      noKeyBindings,
    );
    expect(res.status).toBe(500);
  });

  it("GET /: 未連携（ヘッダも D1 も無し）は connected:false", async () => {
    const app = buildApp();
    const res = await app.request("/me/annict", {}, TEST_BINDINGS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
});
