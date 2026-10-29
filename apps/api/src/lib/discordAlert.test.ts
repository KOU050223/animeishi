import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertKey,
  clearCronFailures,
  CRON_FAILURE_THRESHOLD,
  notifyApiFailures,
  notifyCronFailure,
  notifyUserReport,
  REPORT_SUPPRESS_SECONDS,
  resetLocalSuppression,
  SUPPRESS_SECONDS,
  type ApiFailure,
} from "@/lib/discordAlert";

const WEBHOOK = "https://discord.com/api/webhooks/1/secret-token";

const annict502: ApiFailure = {
  kind: "annict",
  status: 502,
  route: "/me/annict/sync",
  method: "POST",
};
const db500: ApiFailure = {
  kind: "db",
  status: 500,
  route: "/user/:uid",
  method: "GET",
};

// KV の最小フェイク。put の TTL も記録する。
function fakeKv() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const kv = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(
      async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, value);
        ttls.set(key, opts?.expirationTtl);
      },
    ),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
      ttls.delete(key);
    }),
  };
  return { kv: kv as unknown as KVNamespace, store, ttls, raw: kv };
}

function okFetch() {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(null, { status: 204 });
  });
}

function sentBody(fetchImpl: ReturnType<typeof okFetch>, call = 0) {
  const init = fetchImpl.mock.calls[call]![1];
  return JSON.parse(init?.body as string) as {
    content: string;
    allowed_mentions: { parse: string[] };
  };
}

describe("notifyApiFailures", () => {
  beforeEach(() => {
    resetLocalSuppression();
  });

  it("DISCORD_WEBHOOK_URL 未設定なら送らず、理由だけ warn に残す", async () => {
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyApiFailures(
      { ALERT_STATE: kv },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(raw.get).not.toHaveBeenCalled();
    expect(raw.put).not.toHaveBeenCalled();
    const logs = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logs.find((l) => l.event === "discord_alert_failed")).toMatchObject({
      reason: "not_configured",
    });
    warn.mockRestore();
  });

  it("Webhook URL が URL として解釈できなければ fetch せず理由を残す", async () => {
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: "not a url" },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    const logs = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logs.find((l) => l.event === "discord_alert_failed")).toMatchObject({
      reason: "invalid_url",
    });
    warn.mockRestore();
  });

  it("Webhook 送信の失敗理由にはエラー名とメッセージを含める", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(false);
    const logs = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    const failed = logs.find((l) => l.event === "discord_alert_failed");
    expect(failed.op).toBe("webhook");
    expect(String(failed.reason)).toContain("TypeError");
    expect(String(failed.reason)).toContain("fetch failed");
    warn.mockRestore();
  });

  it("失敗理由に Webhook URL（シークレット）は残さない", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`POST ${WEBHOOK} failed`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK },
      [annict502],
      fetchImpl,
    );

    const logs = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    const failed = logs.find((l) => l.event === "discord_alert_failed");
    expect(String(failed.reason)).not.toContain(WEBHOOK);
    expect(String(failed.reason)).toContain("[webhook_url]");
    warn.mockRestore();
  });

  it("失敗理由に Webhook のトークン断片だけが含まれても伏せる", async () => {
    const fetchImpl = vi.fn(async () => {
      // URL 全体ではなくトークン部分だけがメッセージに混ざるケース
      throw new Error("secret-token rejected");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK },
      [annict502],
      fetchImpl,
    );

    const logs = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    const failed = logs.find((l) => l.event === "discord_alert_failed");
    expect(String(failed.reason)).not.toContain("secret-token");
    expect(String(failed.reason)).toContain("[webhook_url]");
    warn.mockRestore();
  });

  it("初回は Webhook に送り、種別:ステータスの印を 30 分の TTL で付ける", async () => {
    const { kv, ttls } = fakeKv();
    const fetchImpl = okFetch();

    const sent = await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(WEBHOOK);
    expect(ttls.get("api:annict:502")).toBe(SUPPRESS_SECONDS);
    expect(SUPPRESS_SECONDS).toBe(1800);
  });

  it("同じ障害は印がある間は再送しない", async () => {
    const { kv } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyApiFailures(env, [annict502], fetchImpl);
    const second = await notifyApiFailures(
      env,
      [{ ...annict502, route: "/me/watch-histories" }],
      fetchImpl,
    );

    expect(second).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("unknown の障害は別ルートなら抑止しない", async () => {
    const { kv } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };
    const unknown500: ApiFailure = {
      kind: "unknown",
      status: 500,
      route: "/user/:uid",
      method: "GET",
    };

    await notifyApiFailures(env, [unknown500], fetchImpl);
    const sameRoute = await notifyApiFailures(env, [unknown500], fetchImpl);
    const otherRoute = await notifyApiFailures(
      env,
      [{ ...unknown500, route: "/me/tier-lists", method: "POST" }],
      fetchImpl,
    );

    expect(sameRoute).toBe(false);
    expect(otherRoute).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("抑止キーは基盤系の種別だけルートを含めない", () => {
    expect(alertKey(annict502)).toBe("api:annict:502");
    expect(alertKey(db500)).toBe("api:db:500");
    expect(
      alertKey({
        kind: "unknown",
        status: 500,
        route: "/x/:id",
        method: "GET",
      }),
    ).toBe("api:unknown:500:GET /x/:id");
  });

  it("同時に走った同じ障害の通知は KV を待たずに 1 通にする", async () => {
    // KV の get が遅く、どちらも印を読む前に走り出すケース。
    const store = new Map<string, string>();
    const slowKv = {
      get: vi.fn(async (key: string) => {
        await new Promise((r) => setTimeout(r, 10));
        return store.get(key) ?? null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace;
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: slowKv };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        notifyApiFailures(env, [annict502], fetchImpl),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("抑止中の障害の後ろに混ざった別の障害は通知する", async () => {
    const { kv } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyApiFailures(env, [annict502], fetchImpl);
    const sent = await notifyApiFailures(env, [annict502, db500], fetchImpl);

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const { content } = sentBody(fetchImpl, 1);
    expect(content).toContain("GET /user/:uid");
    expect(content).not.toContain("/me/annict/sync");
  });

  it("同じ障害は 1 行にまとめて件数を付ける", async () => {
    const fetchImpl = okFetch();

    await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK },
      [annict502, annict502, annict502],
      fetchImpl,
    );

    const { content } = sentBody(fetchImpl);
    expect(content).toContain("`POST /me/annict/sync` → 502（annict） ×3");
  });

  it("KV の読み書きに失敗しても Webhook には送る", async () => {
    const fetchImpl = okFetch();
    const brokenKv = {
      get: vi.fn(async () => {
        throw new Error("kv down");
      }),
      put: vi.fn(async () => {
        throw new Error("kv down");
      }),
    } as unknown as KVNamespace;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: brokenKv },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("ALERT_STATE 未バインドでも Webhook には送る", async () => {
    const fetchImpl = okFetch();

    const sent = await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK },
      [annict502],
      fetchImpl,
    );

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Webhook の送信失敗は reject せず false を返す", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      notifyApiFailures(
        { DISCORD_WEBHOOK_URL: WEBHOOK },
        [annict502],
        fetchImpl,
      ),
    ).resolves.toBe(false);
    warn.mockRestore();
  });

  it("メンションを解釈させず、本文はルート・ステータス・種別だけにする", async () => {
    const fetchImpl = okFetch();

    await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK, ENVIRONMENT: "production" },
      [annict502],
      fetchImpl,
    );

    const body = sentBody(fetchImpl);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toBe(
      [
        "🔴 **[animeishi-api] API 障害**",
        "`POST /me/annict/sync` → 502（annict）",
        "詳細は Sentry を確認。同じ障害の通知は30分止めます。",
      ].join("\n"),
    );
  });

  it("production 以外は環境名を見出しに付ける", async () => {
    const fetchImpl = okFetch();

    await notifyApiFailures(
      { DISCORD_WEBHOOK_URL: WEBHOOK, ENVIRONMENT: "preview" },
      [annict502],
      fetchImpl,
    );

    expect(sentBody(fetchImpl).content).toContain("[animeishi-api preview]");
  });
});

describe("notifyCronFailure / clearCronFailures", () => {
  beforeEach(() => {
    resetLocalSuppression();
  });

  it("1 回目の失敗では送らず、連続 2 回目で cron:<job> として送る", async () => {
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };
    expect(CRON_FAILURE_THRESHOLD).toBe(2);

    const first = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(first).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(raw.put).toHaveBeenCalledWith(
      "cron_fail_count:image_fallback",
      "1",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );

    const second = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(second).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { content, allowed_mentions } = sentBody(fetchImpl);
    expect(content).toContain("[animeishi-api] cron 障害");
    expect(content).toContain("`cron:image_fallback` が 2 回連続で失敗");
    expect(allowed_mentions).toEqual({ parse: [] });
  });

  it("成功（clearCronFailures）で連続カウントが消え、次の失敗はまた 1 回目になる", async () => {
    const { kv, raw, store } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyCronFailure(env, "mal_id_search", fetchImpl);
    raw.get.mockClear();
    await clearCronFailures(env, "mal_id_search");

    // この isolate が失敗を記録しているので get せずに消す。
    expect(raw.get).not.toHaveBeenCalled();
    expect(raw.delete).toHaveBeenCalledWith("cron_fail_count:mal_id_search");
    expect(store.has("cron_fail_count:mal_id_search")).toBe(false);

    const sent = await notifyCronFailure(env, "mal_id_search", fetchImpl);

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("カウントが無い成功では KV を消しにいかない（成功ごとの delete を省く）", async () => {
    const { kv, raw } = fakeKv();

    await clearCronFailures({ ALERT_STATE: kv }, "image_fallback");

    expect(raw.get).toHaveBeenCalledWith("cron_fail_count:image_fallback");
    expect(raw.delete).not.toHaveBeenCalled();
  });

  it("別 isolate が記録したカウント（ローカル無し）は get で見つけて消す", async () => {
    const { kv, raw, store } = fakeKv();
    store.set("cron_fail_count:mal_id_search", "2");

    await clearCronFailures({ ALERT_STATE: kv }, "mal_id_search");

    expect(raw.delete).toHaveBeenCalledWith("cron_fail_count:mal_id_search");
    expect(store.has("cron_fail_count:mal_id_search")).toBe(false);
  });

  it("閾値到達後の通知は 30 分の印で抑止されるが、カウントは進む", async () => {
    const { kv, store } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyCronFailure(env, "image_fallback", fetchImpl);
    await notifyCronFailure(env, "image_fallback", fetchImpl);
    const third = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(third).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.get("cron_fail_count:image_fallback")).toBe("3");
    expect(store.get("cron:image_fallback")).not.toBeUndefined();
  });

  it("ジョブごとに連続カウントと抑止は独立する", async () => {
    const { kv } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyCronFailure(env, "mal_id_search", fetchImpl);
    await notifyCronFailure(env, "mal_id_search", fetchImpl);
    // mal_id_search は 2 回到達済み、image_fallback はこれが 1 回目。
    const otherJob = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(otherJob).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("別 isolate での成功（KV のカウントだけ消える）後は 1 回目として扱う", async () => {
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyCronFailure(env, "mal_id_search", fetchImpl);
    // 別 isolate での成功を模す: KV のカウントだけ消え、
    // この isolate のローカルカウントは残る。
    await raw.delete("cron_fail_count:mal_id_search");

    const sent = await notifyCronFailure(env, "mal_id_search", fetchImpl);

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DISCORD_WEBHOOK_URL 未設定なら送らずカウントも進めない", async () => {
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyCronFailure(
      { ALERT_STATE: kv },
      "image_fallback",
      fetchImpl,
    );

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(raw.get).not.toHaveBeenCalled();
    expect(raw.put).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ALERT_STATE 未バインドでも isolate 内メモリで連続回数を数える", async () => {
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK };

    const first = await notifyCronFailure(env, "image_fallback", fetchImpl);
    const second = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("KV の読み書きに失敗しても連続回数を数えて送る", async () => {
    const fetchImpl = okFetch();
    const brokenKv = {
      get: vi.fn(async () => {
        throw new Error("kv down");
      }),
      put: vi.fn(async () => {
        throw new Error("kv down");
      }),
      delete: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: brokenKv };

    await notifyCronFailure(env, "image_fallback", fetchImpl);
    const second = await notifyCronFailure(env, "image_fallback", fetchImpl);

    expect(second).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("notifyUserReport", () => {
  beforeEach(() => {
    resetLocalSuppression();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("DISCORD_WEBHOOK_URL 未設定なら送らず件数も積まない", async () => {
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await notifyUserReport({ ALERT_STATE: kv }, fetchImpl);

    expect(sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(raw.get).not.toHaveBeenCalled();
    expect(raw.put).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("1 件目は送り、user_report の印を 5 分の TTL で付ける", async () => {
    const { kv, ttls } = fakeKv();
    const fetchImpl = okFetch();

    const sent = await notifyUserReport(
      { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv },
      fetchImpl,
    );

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(WEBHOOK);
    expect(ttls.get("user_report")).toBe(REPORT_SUPPRESS_SECONDS);
    expect(REPORT_SUPPRESS_SECONDS).toBe(300);
  });

  it("抑止中は送らず件数だけ積む", async () => {
    const { kv, store } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyUserReport(env, fetchImpl);
    const second = await notifyUserReport(env, fetchImpl);
    const third = await notifyUserReport(env, fetchImpl);

    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.get("user_report_pending")).toBe("2");
  });

  it("抑止明けの通知は積んだ件数を直近件数として載せてリセットする", async () => {
    vi.useFakeTimers();
    const { kv, raw, store } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyUserReport(env, fetchImpl);
    await notifyUserReport(env, fetchImpl);
    await notifyUserReport(env, fetchImpl);
    // 抑止印の TTL 失効を模す（isolate 内の印は時計を進め、KV の印は消す）。
    vi.setSystemTime(Date.now() + REPORT_SUPPRESS_SECONDS * 1000 + 1000);
    await raw.delete("user_report");

    const sent = await notifyUserReport(env, fetchImpl);

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // 抑止中の 2 件 + 今回の 1 件。
    expect(sentBody(fetchImpl, 1).content).toContain("直近 3 件");
    expect(store.get("user_report_pending")).toBeUndefined();
  });

  it("ALERT_STATE 未バインドでも isolate 内メモリで件数を数える", async () => {
    vi.useFakeTimers();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK };

    await notifyUserReport(env, fetchImpl);
    await notifyUserReport(env, fetchImpl);
    await notifyUserReport(env, fetchImpl);
    vi.setSystemTime(Date.now() + REPORT_SUPPRESS_SECONDS * 1000 + 1000);

    const sent = await notifyUserReport(env, fetchImpl);

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchImpl, 1).content).toContain("直近 3 件");
  });

  it("別 isolate が積算をドレインしても古い件数を再計上しない", async () => {
    vi.useFakeTimers();
    const { kv, raw } = fakeKv();
    const fetchImpl = okFetch();
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyUserReport(env, fetchImpl);
    await notifyUserReport(env, fetchImpl);
    // 別 isolate が通知して KV の積算をドレインした状態を模す。
    await raw.delete("user_report_pending");
    vi.setSystemTime(Date.now() + REPORT_SUPPRESS_SECONDS * 1000 + 1000);
    await raw.delete("user_report");

    const sent = await notifyUserReport(env, fetchImpl);

    expect(sent).toBe(true);
    expect(sentBody(fetchImpl, 1).content).toContain(
      "新しい通報がありました。",
    );
    expect(sentBody(fetchImpl, 1).content).not.toContain("直近");
  });

  it("KV への書き込みに失敗した分はメモリに退避し、次の通知で合算する", async () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    let failPut = false;
    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        if (failPut) throw new Error("kv down");
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    } as unknown as KVNamespace;
    const fetchImpl = okFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { DISCORD_WEBHOOK_URL: WEBHOOK, ALERT_STATE: kv };

    await notifyUserReport(env, fetchImpl);
    failPut = true;
    // 抑止中・put 失敗: KV に残らないためメモリに退避する。
    await notifyUserReport(env, fetchImpl);
    failPut = false;
    // 抑止中・put 成功: KV に 1 件積まれる。
    await notifyUserReport(env, fetchImpl);
    vi.setSystemTime(Date.now() + REPORT_SUPPRESS_SECONDS * 1000 + 1000);
    store.delete("user_report");

    const sent = await notifyUserReport(env, fetchImpl);

    expect(sent).toBe(true);
    // KV の 1 件 + メモリの 1 件 + 今回の 1 件。
    expect(sentBody(fetchImpl, 1).content).toContain("直近 3 件");
    warn.mockRestore();
  });

  it("本文に ID・理由は入れず、件数と reports:list の案内だけにする", async () => {
    const fetchImpl = okFetch();

    await notifyUserReport({ DISCORD_WEBHOOK_URL: WEBHOOK }, fetchImpl);

    const body = sentBody(fetchImpl);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toBe(
      [
        "🔔 **[animeishi-api] ユーザー通報**",
        "新しい通報がありました。",
        "詳細は `pnpm task reports:list` で確認。同じ通知は5分止めます。",
      ].join("\n"),
    );
  });
});
