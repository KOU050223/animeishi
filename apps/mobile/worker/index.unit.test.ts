import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

const SHELL_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>アニ名刺</title>
  <meta
    name="description"
    content="アニメの視聴記録がそのまま名刺に。好きな作品や推しを共有して、アニメ好きとつながろう。"
  />
  <meta
    property="og:title"
    content="アニ名刺 — 好きの記録が、あなたの名刺になる。"
  />
  <meta
    property="og:description"
    content="観た作品も、推しへの熱も。アニメ好きのあなたらしさを形にして、次の出会いにつなげよう。"
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://animeishi.uomi.dev/" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta
    name="twitter:title"
    content="アニ名刺 — 好きの記録が、あなたの名刺になる。"
  />
  <meta
    name="twitter:description"
    content="観た作品も、推しへの熱も。アニメ好きのあなたらしさを形にして、次の出会いにつなげよう。"
  />
</head>
<body><div id="root"></div></body>
</html>`;

function shellResponse(html: string = SHELL_HTML) {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function makeEnv({
  withApi = true,
  forwardViaFetch,
  assetsResponse,
  apiResponse,
}: {
  withApi?: boolean;
  forwardViaFetch?: string;
  assetsResponse?: () => Response;
  apiResponse?: () => Response;
} = {}) {
  const env = {
    API_ORIGIN: "https://api.example.com",
    SHARE_FORWARD_VIA_FETCH: forwardViaFetch,
    ASSETS: {
      fetch: vi.fn(async () => assetsResponse?.() ?? new Response("assets")),
    },
    ...(withApi
      ? {
          API: {
            fetch: vi.fn(
              async (request: Request) =>
                apiResponse?.() ??
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
function req(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<
    typeof worker.fetch
  >[0];
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
    for (const path of ["/user/abc", "/sharex", "/shares/1"]) {
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

describe("GET / の認証 Cookie 判定", () => {
  it("HEAD / はリダイレクトしない", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/", { method: "HEAD" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    "other=value",
    "__client_uat=0",
    "__session=; __client_uat=0",
    "__session=token; __client_uat=0",
  ])("Cookie %s は /welcome へ 302 で移す", async (cookie) => {
    const env = makeEnv();
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/", {
        headers: cookie ? { cookie } : {},
      }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://animeishi.uomi.dev/welcome",
    );
    // 応答が Cookie 依存なので、キャッシュが別状態の応答を
    // 使い回さないよう Vary: Cookie を付ける
    expect(res.headers.get("vary")).toContain("cookie");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(["__session=token", "__client_uat=123"])(
    "Cookie %s があればトップを配信する",
    async (cookie) => {
      const env = makeEnv({ assetsResponse: shellResponse });
      const res = await worker.fetch(
        req("https://animeishi.uomi.dev/", {
          headers: { cookie },
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("vary")).toContain("cookie");
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe("/user/:uid のクローラ転送", () => {
  const BOT_UA =
    "Mozilla/5.0 (compatible; Twitterbot/1.0; +https://twitter.com)";
  const BROWSER_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36";

  it("クローラ UA には API へ転送し Accept: text/html を強制する", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc", {
        headers: { "user-agent": BOT_UA, accept: "*/*" },
      }),
      env,
    );
    const forwarded = env.API?.fetch.mock.calls[0]?.[0];
    expect(env.API?.fetch).toHaveBeenCalledTimes(1);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    // bot は Accept: */* 等で来るが、API は text/html 要求時だけ
    // OGP HTML を返すため、ここで明示する
    expect(forwarded?.headers.get("accept")).toBe("text/html");
    expect(forwarded?.url).toBe("https://api.example.com/user/user_abc");
  });

  it("末尾スラッシュの /user/:uid/ はスラッシュを落として API 転送する", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc/", {
        headers: { "user-agent": "discordbot/2.0" },
      }),
      env,
    );
    expect(env.API?.fetch).toHaveBeenCalledTimes(1);
    // API のルートは /:uid のみ受け付ける strict ルーティングのため、
    // 末尾スラッシュを残すと公開プロフィールでも 404 になる
    expect(env.API?.fetch.mock.calls[0]?.[0]?.url).toBe(
      "https://api.example.com/user/user_abc",
    );
  });

  it("クローラ転送では Cookie / Authorization を落とす", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc", {
        headers: {
          "user-agent": "Googlebot",
          cookie: "__session=secret",
          authorization: "Bearer token",
        },
      }),
      env,
    );
    const forwarded = env.API?.fetch.mock.calls[0]?.[0];
    expect(forwarded?.headers.get("cookie")).toBeNull();
    expect(forwarded?.headers.get("authorization")).toBeNull();
  });

  it("API 応答の Vary: Accept を保持しつつ User-Agent を併記する", async () => {
    const env = makeEnv({
      apiResponse: () => new Response("ogp", { headers: { vary: "Accept" } }),
    });
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc", {
        headers: { "user-agent": "Googlebot" },
      }),
      env,
    );
    const vary = (res.headers.get("vary") ?? "").toLowerCase();
    expect(vary).toContain("accept");
    expect(vary).toContain("user-agent");
  });

  it("アプリ内ブラウザの UA（Line/x.y, Slack/, Pinterest）はクローラと判定しない", async () => {
    // LINE・Slack・Pinterest のアプリ内ブラウザは静的 OGP HTML ではなく
    // 操作できる SPA を返したいので、bot 固有のトークンだけで判定する
    const env = makeEnv();
    const webViewUas = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/13.9.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Slack/24.01.10",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [Pinterest/iOS]",
    ];
    for (const ua of webViewUas) {
      env.API?.fetch.mockClear();
      env.ASSETS.fetch.mockClear();
      await worker.fetch(
        req("https://animeishi.uomi.dev/user/user_abc", {
          headers: { "user-agent": ua },
        }),
        env,
      );
      expect(env.API?.fetch).not.toHaveBeenCalled();
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("Slack・LINE のリンク展開 bot はクローラ転送する", async () => {
    const env = makeEnv();
    for (const ua of [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Slack-ImgProxy 0.9)",
      "Linepoker/1.0",
    ]) {
      env.API?.fetch.mockClear();
      env.ASSETS.fetch.mockClear();
      await worker.fetch(
        req("https://animeishi.uomi.dev/user/user_abc", {
          headers: { "user-agent": ua },
        }),
        env,
      );
      expect(env.API?.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("GET/HEAD 以外はクローラ UA でも API へ転送せず SPA を返す", async () => {
    const env = makeEnv();
    await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc", {
        method: "POST",
        headers: { "user-agent": "Googlebot" },
        body: "x",
      }),
      env,
    );
    expect(env.API?.fetch).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it("ブラウザ UA には SPA を返し、Vary: User-Agent を付ける", async () => {
    const env = makeEnv({ assetsResponse: () => shellResponse() });
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/user/user_abc", {
        headers: { "user-agent": BROWSER_UA },
      }),
      env,
    );
    expect(env.API?.fetch).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain(
      "user-agent",
    );
  });
});

describe("プリレンダ HTML と SPA フォールバック", () => {
  it.each(["/welcome", "/privacy", "/terms", "/support"])(
    "%s の HTML は書き換えない",
    async (path) => {
      const html =
        "<html><head><title>公開ページ</title></head><body>本文</body></html>";
      const env = makeEnv({ assetsResponse: () => shellResponse(html) });
      const res = await worker.fetch(
        req(`https://animeishi.uomi.dev${path}`),
        env,
      );
      expect(await res.text()).toBe(html);
    },
  );

  it.each([
    "/",
    "/sign-in",
    "/article",
    "/article/example",
    "/event",
    "/event/example",
    "/election",
  ])("%s の HTML に noindex を付ける", async (path) => {
    const env = makeEnv({ assetsResponse: () => shellResponse() });
    const res = await worker.fetch(
      req(`https://animeishi.uomi.dev${path}`, {
        headers: { cookie: "__session=token" },
      }),
      env,
    );
    expect(await res.text()).toContain('name="robots" content="noindex"');
  });

  it("HTML 以外のアセットは書き換えない", async () => {
    const env = makeEnv({
      assetsResponse: () =>
        new Response("png-bytes", { headers: { "content-type": "image/png" } }),
    });
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/sign-in"),
      env,
    );
    expect(await res.text()).toBe("png-bytes");
  });
});

describe("wrangler.toml の run_worker_first", () => {
  // 一覧ルート（app/<name>/index.tsx）の裸パスは /<name>/* には
  // マッチせず静的アセットが直配信されるため noindex が付かない。
  // Worker を通すには裸パスも個別に登録が必要（issue #652）。
  const wranglerToml = readFileSync(
    new URL("../wrangler.toml", import.meta.url),
    "utf8",
  );

  it.each(["/article", "/event", "/election"])(
    "一覧パス %s が Worker 経由になる",
    (path) => {
      expect(wranglerToml).toContain(`"${path}"`);
    },
  );
});

describe("セキュリティヘッダ", () => {
  const FORCED = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
  };

  it.each([
    ["/share/tier-lists/tok-1", {}],
    ["/", {}],
    ["/welcome", {}],
    ["/sign-in", {}],
    ["/sign-in", { method: "POST" }],
  ])(
    "%s の応答に強制ヘッダと Report-Only の CSP が付く",
    async (path, init) => {
      const env = makeEnv({ assetsResponse: () => shellResponse() });
      const res = await worker.fetch(
        req(`https://animeishi.uomi.dev${path}`, init),
        env,
      );
      for (const [name, value] of Object.entries(FORCED)) {
        expect(res.headers.get(name)).toBe(value);
      }
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("content-security-policy-report-only")).toContain(
        "frame-ancestors 'none'",
      );
    },
  );

  it("API から中継した共有ページの CSP は上書きしない", async () => {
    const apiCsp = "default-src 'none'; img-src 'self' https:";
    const env = makeEnv({
      apiResponse: () =>
        new Response("<p>share</p>", {
          headers: {
            "content-type": "text/html",
            "content-security-policy-report-only": apiCsp,
          },
        }),
    });
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/share/tier-lists/tok-1"),
      env,
    );
    expect(res.headers.get("content-security-policy-report-only")).toBe(apiCsp);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("リダイレクトの Location と Vary は保たれる", async () => {
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/"),
      makeEnv(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://animeishi.uomi.dev/welcome",
    );
    expect(res.headers.get("vary")).toContain("cookie");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("CSP の connect-src に API_ORIGIN を含める", async () => {
    const res = await worker.fetch(
      req("https://animeishi.uomi.dev/welcome"),
      makeEnv(),
    );
    expect(res.headers.get("content-security-policy-report-only")).toMatch(
      /connect-src [^;]*https:\/\/api\.example\.com/,
    );
  });

  it("静的アセット直配信用の public/_headers も同じ値を付ける", () => {
    const headersFile = readFileSync(
      new URL("../public/_headers", import.meta.url),
      "utf8",
    ).toLowerCase();
    for (const [name, value] of Object.entries(FORCED)) {
      expect(headersFile).toContain(`  ${name}: ${value.toLowerCase()}`);
    }
  });
});
