import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  DEFAULT_POSTHOG_HOST,
  captureServerEvent,
  hashedUserKey,
  sendServerEvent,
} from "./posthog";

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
}

function sentBody(fetchMock: ReturnType<typeof okFetch>) {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown> & {
    properties: Record<string, unknown>;
  };
}

describe("hashedUserKey", () => {
  it("mobile と同じソルト付き SHA-256 の先頭 16 文字になる", async () => {
    // sha256("animeishi-annict-funnel-v1:user_abc") の先頭 16 文字
    const expected = await crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode("animeishi-annict-funnel-v1:user_abc"),
      )
      .then((d) =>
        [...new Uint8Array(d)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16),
      );
    await expect(hashedUserKey("user_abc")).resolves.toBe(expected);
    expect(expected).toHaveLength(16);
  });
});

describe("sendServerEvent", () => {
  it("POSTHOG_KEY が無ければ送らない", async () => {
    const fetchMock = okFetch();
    await expect(
      sendServerEvent({}, "exchange_complete", "user_a", {}, fetchMock),
    ).resolves.toBe(false);
    await expect(
      sendServerEvent(
        { POSTHOG_KEY: "  " },
        "exchange_complete",
        "user_a",
        {},
        fetchMock,
      ),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("capture API へハッシュ済み distinct_id で送り、生の userId は載せない", async () => {
    const fetchMock = okFetch();
    await expect(
      sendServerEvent(
        { POSTHOG_KEY: "phc_test", ENVIRONMENT: "production" },
        "exchange_complete",
        "user_raw_id",
        { token: "qr" },
        fetchMock,
      ),
    ).resolves.toBe(true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${DEFAULT_POSTHOG_HOST}/i/v0/e/`);
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("phc_test");
    expect(body.event).toBe("exchange_complete");
    expect(body.distinct_id).toBe(await hashedUserKey("user_raw_id"));
    expect(body.properties).toMatchObject({
      token: "qr",
      environment: "production",
      platform: "server",
      $geoip_disable: true,
    });
    expect(JSON.stringify(body)).not.toContain("user_raw_id");
  });

  it("POSTHOG_HOST で送信先を変えられる", async () => {
    const fetchMock = okFetch();
    await sendServerEvent(
      { POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com/" },
      "sign_up_complete",
      "user_a",
      {},
      fetchMock,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://eu.i.posthog.com/i/v0/e/",
    );
  });

  it("送信に失敗しても reject しない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    await expect(
      sendServerEvent(
        { POSTHOG_KEY: "phc_test" },
        "sign_up_complete",
        "user_a",
        {},
        fetchMock,
      ),
    ).resolves.toBe(false);
  });
});

describe("captureServerEvent", () => {
  function appWith(onRequest: () => void) {
    const app = new Hono();
    app.get("/", (c) => {
      captureServerEvent(c, "exchange_complete", "user_a");
      onRequest();
      return c.text("ok");
    });
    return app;
  }

  it("キーがあれば waitUntil に送信を積み、応答を待たせない", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const waitUntil = vi.fn();
    const res = await appWith(() => {}).request(
      "/",
      {},
      { POSTHOG_KEY: "phc_test" },
      { waitUntil, passThroughOnException: vi.fn(), props: {} },
    );
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("キーが無ければ waitUntil も fetch も呼ばない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const waitUntil = vi.fn();
    await appWith(() => {}).request(
      "/",
      {},
      {},
      { waitUntil, passThroughOnException: vi.fn(), props: {} },
    );
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
