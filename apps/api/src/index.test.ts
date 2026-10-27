import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { resetLocalSuppression } from "@/lib/discordAlert";

// cron ハンドラが呼ぶ 2 ジョブだけ差し替える。D1・外部 API には出ない。
const jobs = vi.hoisted(() => ({
  resolveMissingMalIds: vi.fn<(db: unknown) => Promise<number>>(),
  resolvePendingImageFallbacks:
    vi.fn<(...args: unknown[]) => Promise<number>>(),
}));

vi.mock("@sentry/cloudflare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/cloudflare")>();
  return {
    ...actual,
    // withSentry は素通しにして default export の scheduled を直接呼べるようにする。
    withSentry: vi.fn((_options: unknown, handler: unknown) => handler),
    captureException: vi.fn(),
  };
});

vi.mock("@/lib/annict/kitsuTitleSearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/annict/kitsuTitleSearch")>()),
  resolveMissingMalIds: jobs.resolveMissingMalIds,
}));

vi.mock("@/lib/annict/imageFallbackPending", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/annict/imageFallbackPending")
  >()),
  resolvePendingImageFallbacks: jobs.resolvePendingImageFallbacks,
}));

import handler from "@/index";

const WEBHOOK = "https://discord.com/api/webhooks/1/secret-token";
const captureException = vi.mocked(Sentry.captureException);

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace;
}

// scheduled は waitUntil に非同期処理を積むだけなので、積まれた promise が
// すべて終わるのを待ってから検証する。
function runScheduled(env: object): Promise<unknown[]> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      pending.push(p);
    }),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  handler.scheduled!(
    { cron: "*/10 * * * *", scheduledTime: Date.now() } as ScheduledController,
    env as never,
    ctx,
  );
  return Promise.all(pending);
}

function cronEnv(kv: KVNamespace) {
  return {
    DB: {},
    DISCORD_WEBHOOK_URL: WEBHOOK,
    ALERT_STATE: kv,
    ENVIRONMENT: "production",
  };
}

describe("scheduled cron の失敗通知（issue #233）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetLocalSuppression();
    jobs.resolveMissingMalIds.mockResolvedValue(0);
    jobs.resolvePendingImageFallbacks.mockResolvedValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("両ジョブが成功したら Sentry にも Discord にも送らない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await runScheduled(cronEnv(fakeKv()));

    expect(jobs.resolveMissingMalIds).toHaveBeenCalledTimes(1);
    expect(jobs.resolvePendingImageFallbacks).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("1 回の失敗は Sentry にだけ送り、もう片方のジョブは実行される", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    jobs.resolveMissingMalIds.mockRejectedValueOnce(new Error("kitsu down"));

    await runScheduled(cronEnv(fakeKv()));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
    // 失敗しても image_fallback は止まらない。
    expect(jobs.resolvePendingImageFallbacks).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("連続して失敗すると同じジョブだけ Discord に送る", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const kv = fakeKv();
    const env = cronEnv(kv);
    jobs.resolveMissingMalIds.mockRejectedValue(new Error("kitsu down"));

    await runScheduled(env);
    expect(fetchSpy).not.toHaveBeenCalled();

    await runScheduled(env);

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain("`cron:mal_id_search` が 2 回連続で失敗");
    expect(body).not.toContain("image_fallback");
  });

  it("途中で成功すると連続カウントがリセットされ、次の失敗は送らない", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const kv = fakeKv();
    const env = cronEnv(kv);
    jobs.resolveMissingMalIds.mockRejectedValueOnce(new Error("kitsu down"));

    await runScheduled(env); // 失敗 1 回目
    await runScheduled(env); // 成功 → カウント消去
    jobs.resolveMissingMalIds.mockRejectedValueOnce(new Error("kitsu down"));
    await runScheduled(env); // 失敗だが再び 1 回目扱い

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("image_fallback だけが連続失敗しても通知される", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const env = cronEnv(fakeKv());
    jobs.resolvePendingImageFallbacks.mockRejectedValue(new Error("d1 down"));

    await runScheduled(env);
    await runScheduled(env);

    expect(jobs.resolveMissingMalIds).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain(
      "`cron:image_fallback` が 2 回連続で失敗",
    );
  });

  it("DISCORD_WEBHOOK_URL 未設定でも Sentry には送る", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { DB } = cronEnv(fakeKv());
    jobs.resolveMissingMalIds.mockRejectedValue(new Error("kitsu down"));

    await runScheduled({ DB });
    await runScheduled({ DB });

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
