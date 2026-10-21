import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import * as Sentry from "@sentry/cloudflare";
import { AnnictApiError } from "@/lib/annict/client";
import { DeletedUserError } from "@/features/users/repository";
import { buildSentryOptions, handleError } from "@/observability";

vi.mock("@sentry/cloudflare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/cloudflare")>();
  return { ...actual, captureException: vi.fn() };
});

// index.ts と同じ構成の最小アプリ。requestId → route → handleError の
// 流れを検証するため、本物の index.ts ではなくここで組み立てる。
const app = new Hono();
app.use("*", requestId());
app.onError(handleError);
app
  .get("/boom", () => {
    throw new Error("boom");
  })
  .get("/annict-401", () => {
    throw new AnnictApiError("token expired", 401);
  })
  .get("/annict-0", () => {
    throw new AnnictApiError("network error", 0);
  })
  .get("/annict-200", () => {
    // HTTP 200 の GraphQL エラー等、異常応答は上流ステータスが 200 で入る
    throw new AnnictApiError("graphql errors", 200);
  })
  .get("/annict-429", () => {
    throw new AnnictApiError("rate limited", 429);
  })
  .get("/annict-502", () => {
    throw new AnnictApiError("upstream error", 502);
  })
  .get("/http-400", () => {
    throw new HTTPException(400, { message: "bad request" });
  })
  .get("/http-503", () => {
    throw new HTTPException(503, { message: "unavailable" });
  })
  .get("/deleted-user", () => {
    throw new DeletedUserError("user_deleted001");
  })
  .get("/users/:uid/boom", (c) => {
    throw new Error(`boom for ${c.req.param("uid")}`);
  });

const captureException = vi.mocked(Sentry.captureException);

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未処理例外は requestId 付きの 500 JSON を返し Sentry に送る", async () => {
    const res = await app.request("/boom", {
      headers: { "X-Request-Id": "req-test-1" },
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("X-Request-Id")).toBe("req-test-1");
    expect(await res.json()).toEqual({
      error: "サーバーエラーが発生しました",
      code: "internal_error",
      requestId: "req-test-1",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("Annict 401 は 401 を返し Sentry に送らない", async () => {
    const res = await app.request("/annict-401");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Annict 連携が無効です",
      code: "annict_token_invalid",
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("Annict 通信失敗（status 0）は 502 を返し Sentry に送る", async () => {
    const res = await app.request("/annict-0");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Annict との通信に失敗しました",
      code: "annict_upstream",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("Annict 200 の異常応答（GraphQL エラー等）は 502 を返し Sentry に送る", async () => {
    const res = await app.request("/annict-200");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Annict との通信に失敗しました",
      code: "annict_upstream",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("Annict 429（レート制限）は 502 を返し Sentry に送る", async () => {
    const res = await app.request("/annict-429");

    expect(res.status).toBe(502);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("Annict 502 は 502 を返し Sentry に送る", async () => {
    const res = await app.request("/annict-502");

    expect(res.status).toBe(502);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("HTTPException 4xx はそのまま返し Sentry に送らない", async () => {
    const res = await app.request("/http-400");

    expect(res.status).toBe(400);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("HTTPException 5xx はそのまま返し Sentry に送る", async () => {
    const res = await app.request("/http-503");

    expect(res.status).toBe(503);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("DeletedUserError は 401 を返し Sentry に送らない", async () => {
    const res = await app.request("/deleted-user");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("capture 時のスコープに requestId と request コンテキストを付ける", async () => {
    await app.request("/boom", {
      headers: { "X-Request-Id": "req-scope-1" },
    });

    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe("buildSentryOptions", () => {
  it("SENTRY_DSN 未設定なら enabled:false で no-op 化する", () => {
    const options = buildSentryOptions({});

    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it("environment は ENVIRONMENT を正規化する", () => {
    expect(buildSentryOptions({ ENVIRONMENT: "production" }).environment).toBe(
      "production",
    );
    expect(buildSentryOptions({ ENVIRONMENT: "preview" }).environment).toBe(
      "preview",
    );
    expect(buildSentryOptions({}).environment).toBe("development");
  });

  it("release は CF_VERSION_METADATA.id から組み立てる", () => {
    const options = buildSentryOptions({
      CF_VERSION_METADATA: { id: "v-1", tag: "t", timestamp: "0" },
    });
    expect(options.release).toBe("animeishi-api@v-1");
    expect(buildSentryOptions({}).release).toBe("animeishi-api@dev");
  });

  it("tracing は無効・PII/body/クエリは送らない設定にする", () => {
    const options = buildSentryOptions({});

    expect(options.tracesSampleRate).toBe(0);
    expect(options.dataCollection?.userInfo).toBe(false);
    expect(options.dataCollection?.httpBodies).toEqual([]);
    expect(options.dataCollection?.urlQueryParams).toBe(false);
  });
});

describe("handleError の Discord 通知", () => {
  const WEBHOOK = "https://discord.com/api/webhooks/1/secret-token";

  function fakeCtx() {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((p: Promise<unknown>) => {
        pending.push(p);
      }),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("サーバー障害は waitUntil でルートパターンとステータスだけを送る", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { ctx, settle } = fakeCtx();

    const res = await app.request(
      "/users/user_secret123/boom?token=abc",
      {},
      { DISCORD_WEBHOOK_URL: WEBHOOK, ENVIRONMENT: "production" },
      ctx,
    );
    await settle();

    expect(res.status).toBe(500);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain("GET /users/:uid/boom");
    expect(body).toContain("500");
    expect(body).not.toContain("user_secret123");
    expect(body).not.toContain("token=abc");
    expect(body).not.toContain("boom for");
  });

  it("Annict の上流障害は返した 502 で通知する", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { ctx, settle } = fakeCtx();

    await app.request("/annict-0", {}, { DISCORD_WEBHOOK_URL: WEBHOOK }, ctx);
    await settle();

    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain(
      "GET /annict-0` → 502（annict）",
    );
  });

  it("Sentry に送らないユーザー要因のエラーは通知しない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ctx } = fakeCtx();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK };

    await app.request("/annict-401", {}, env, ctx);
    await app.request("/http-400", {}, env, ctx);
    await app.request("/deleted-user", {}, env, ctx);

    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DISCORD_WEBHOOK_URL 未設定なら送らない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ctx, settle } = fakeCtx();

    const res = await app.request("/boom", {}, {}, ctx);
    await settle();

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
