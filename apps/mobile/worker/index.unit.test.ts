import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

function makeEnv({
  withApi = true,
  forwardViaFetch,
}: { withApi?: boolean; forwardViaFetch?: string } = {}) {
  const env = {
    API_ORIGIN: "https://api.example.com",
    SHARE_FORWARD_VIA_FETCH: forwardViaFetch,
    ASSETS: {
      fetch: vi.fn(async () => new Response("assets")),
    },
    ...(withApi
      ? {
          API: {
            fetch: vi.fn(
              async (request: Request) =>
                new Response(`api:${new URL(request.url).toString()}`),
            ),
          },
        }
      : {}),
  };
  // Fetcher は connect 等も持つが、worker は fetch だけを使う。
  // vi.fn の mock 性を残したまま Env として渡せるよう交差型にする。
  return env as typeof env & Parameters<typeof worker.fetch>[1];
}

// worker.fetch は workers-types の Request（IncomingRequestCfProperties 付き）
// を要求するが、テストで作るのは DOM の Request。実行時は同一オブジェクト
// なので、ここだけ型を合わせる。
function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof worker.fetch>[0];
}

describe("web 転送 Worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/share/* は API へ転送する", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/share/tier-lists/tok-1"),
      env,
    );
    expect(env.API?.fetch).toHaveBeenCalledTimes(1);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(await res.text()).toBe(
      "api:https://api.example.com/share/tier-lists/tok-1",
    );
  });

  it("転送時はリクエスト URL のオリジンを API_ORIGIN に書き換える", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("https://animeishi.uomi.dev/share/work-lists/tok-2?x=1"),
      env,
    );
    const forwarded = env.API?.fetch.mock.calls[0]?.[0];
    // API 側がリクエストのオリジンから画像プロキシ URL を組み立てるため、
    // パスとクエリは保ったままオリジンだけ API のものになる
    expect(forwarded?.url).toBe(
      "https://api.example.com/share/work-lists/tok-2?x=1",
    );
  });

  it("ローカル開発のポート付き URL でも転送先にポートが残らない", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("http://localhost:8787/share/tier-lists/tok-9"),
      env,
    );
    const forwarded = env.API?.fetch.mock.calls[0]?.[0];
    // url.host の代入ではポートが残ってしまうため、hostname / port を
    // 分けて上書きしている（残ると api.example.com:8787 へ接続して張る）
    expect(forwarded?.url).toBe(
      "https://api.example.com/share/tier-lists/tok-9",
    );
  });

  it("元リクエストの host ヘッダは転送しない", async () => {
    const env = makeEnv();
    const incoming = new Request(
      "https://animeishi.uomi.dev/share/tier-lists/tok-4",
      { headers: { host: "animeishi.uomi.dev" } },
    ) as unknown as Parameters<typeof worker.fetch>[0];
    await worker.fetch(incoming, env);
    const forwarded = env.API?.fetch.mock.calls[0]?.[0];
    // host が残ると公開 fetch で web の zone へ再ルーティングされて
    // /share/* が無限ループする
    expect(forwarded?.headers.get("host")).toBeNull();
  });

  it("Service Binding が無い環境（ローカル dev 等）は API_ORIGIN への fetch で転送する", async () => {
    const publicFetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          `public:${new URL(input instanceof Request ? input.url : input).toString()}`,
        ),
    );
    vi.stubGlobal("fetch", publicFetch);

    const env = makeEnv({ withApi: false });
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/share/tier-lists/tok-3"),
      env,
    );
    expect(publicFetch).toHaveBeenCalledTimes(1);
    const forwarded = publicFetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(
      "https://api.example.com/share/tier-lists/tok-3",
    );
    expect(await res.text()).toBe(
      "public:https://api.example.com/share/tier-lists/tok-3",
    );
  });

  it("SHARE_FORWARD_VIA_FETCH=true なら Service Binding があっても fetch で転送する", async () => {
    const publicFetch = vi.fn(async () => new Response("public"));
    vi.stubGlobal("fetch", publicFetch);

    // PR プレビューは animeishi-web-production のエイリアスとして載るため
    // production の binding が継承されるが、転送先は PR の API プレビュー
    // （binding では届かない）にしたいので var で fetch を強制する
    const env = makeEnv({ forwardViaFetch: "true" });
    await worker.fetch(
      req(
        "https://pr-1-animeishi-web-production.uozumi05.workers.dev/share/tier-lists/tok-5",
      ),
      env,
    );
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(env.API?.fetch).not.toHaveBeenCalled();
  });

  it("/share/* 以外は ASSETS へ渡す", async () => {
    const env = makeEnv();
    for (const path of ["/", "/user/abc", "/sharex", "/shares/1"]) {
      env.API?.fetch.mockClear();
      env.ASSETS.fetch.mockClear();
      const res = await worker.fetch(
        req(`https://animeishi.uomi.dev${path}`),
        env,
      );
      expect(env.API?.fetch).not.toHaveBeenCalled();
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
      expect(await res.text()).toBe("assets");
    }
  });
});
