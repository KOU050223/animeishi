import {
  buildAuthorizeUrl,
  encodeWebOAuthState,
  parseAuthCallback,
  resolveAnnictRelayTarget,
  ANNICT_AUTHORIZE_ENDPOINT,
  ANNICT_SCOPE,
} from "@/lib/annict/oauth";

describe("buildAuthorizeUrl", () => {
  it("認可エンドポイントに必要なパラメータを載せる", () => {
    const url = buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "animeishi://annict",
      state: "st_123",
    });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      ANNICT_AUTHORIZE_ENDPOINT,
    );
    expect(parsed.searchParams.get("client_id")).toBe("cid");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("animeishi://annict");
    expect(parsed.searchParams.get("scope")).toBe(ANNICT_SCOPE);
    expect(parsed.searchParams.get("state")).toBe("st_123");
  });

  it("scope は read write をデフォルトに要求する（updateStatus 用）", () => {
    const url = buildAuthorizeUrl({
      clientId: "c",
      redirectUri: "r",
      state: "s",
    });
    expect(new URL(url).searchParams.get("scope")).toBe("read write");
  });
});

describe("parseAuthCallback", () => {
  const state = "expected_state";

  it("state 一致で code を取り出す", () => {
    const result = parseAuthCallback(
      `animeishi://annict?code=abc&state=${state}`,
      state,
    );
    expect(result).toEqual({ ok: true, code: "abc" });
  });

  it("state 不一致は state_mismatch", () => {
    const result = parseAuthCallback(
      "animeishi://annict?code=abc&state=other",
      state,
    );
    expect(result).toEqual({ ok: false, error: "state_mismatch" });
  });

  it("error パラメータがあれば失敗", () => {
    const result = parseAuthCallback(
      `animeishi://annict?error=access_denied&state=${state}`,
      state,
    );
    expect(result).toEqual({ ok: false, error: "access_denied" });
  });

  it("code 欠落は missing_code", () => {
    const result = parseAuthCallback(
      `animeishi://annict?state=${state}`,
      state,
    );
    expect(result).toEqual({ ok: false, error: "missing_code" });
  });

  it("不正な URL は invalid_callback_url", () => {
    const result = parseAuthCallback("not a url", state);
    expect(result).toEqual({ ok: false, error: "invalid_callback_url" });
  });
});

describe("resolveAnnictRelayTarget", () => {
  const PROD = "https://animeishi-web-production.uozumi05.workers.dev";
  const PREVIEW = "https://pr-1-animeishi-web-production.uozumi05.workers.dev";
  const ORIGINAL_WEB_REDIRECT = process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI = ORIGINAL_WEB_REDIRECT;
  });

  function callbackOn(origin: string, state: string, extra = ""): string {
    return `${origin}/annict?code=auth_code&state=${encodeURIComponent(state)}${extra}`;
  }

  it("プレビュー宛の state はそのオリジンの /annict へ中継する", () => {
    const state = encodeWebOAuthState(PREVIEW, "uuid-1");
    const target = resolveAnnictRelayTarget(callbackOn(PROD, state), PROD);

    const parsed = new URL(target ?? "");
    expect(parsed.origin).toBe(PREVIEW);
    expect(parsed.pathname).toBe("/annict");
    expect(parsed.searchParams.get("code")).toBe("auth_code");
    // state は戻り先の sessionStorage と全体一致で照合されるため改変しない。
    expect(parsed.searchParams.get("state")).toBe(state);
  });

  it("error パラメータ付きのコールバックも中継する", () => {
    const state = encodeWebOAuthState(PREVIEW, "uuid-1");
    const target = resolveAnnictRelayTarget(
      `${PROD}/annict?error=access_denied&state=${encodeURIComponent(state)}`,
      PROD,
    );
    expect(target).not.toBeNull();
    expect(new URL(target ?? "").searchParams.get("error")).toBe(
      "access_denied",
    );
  });

  it("自分宛の state（戻り先 = 現在オリジン）は中継しない", () => {
    const state = encodeWebOAuthState(PROD, "uuid-1");
    expect(resolveAnnictRelayTarget(callbackOn(PROD, state), PROD)).toBeNull();
  });

  it("localhost は開発用に任意ポートで中継を許可する", () => {
    const state = encodeWebOAuthState("http://localhost:8081", "uuid-1");
    const target = resolveAnnictRelayTarget(callbackOn(PROD, state), PROD);
    expect(new URL(target ?? "").origin).toBe("http://localhost:8081");
  });

  it("許可リスト外のオリジンには中継しない（open redirect 防止）", () => {
    const state = encodeWebOAuthState("https://evil.example.com", "uuid-1");
    expect(resolveAnnictRelayTarget(callbackOn(PROD, state), PROD)).toBeNull();
  });

  it("http スキームの外部オリジンには中継しない", () => {
    const state = encodeWebOAuthState("http://animeishi.uomi.dev", "uuid-1");
    expect(resolveAnnictRelayTarget(callbackOn(PROD, state), PROD)).toBeNull();
  });

  it("オリジン埋め込みでない素の state（旧形式）は中継しない", () => {
    const target = resolveAnnictRelayTarget(
      callbackOn(PROD, "plain-uuid-state"),
      PROD,
    );
    expect(target).toBeNull();
  });

  it("正規 URL が独自ドメインでも、設定値由来のホストのプレビューへ中継できる", () => {
    // canonical を独自ドメインで受け、redirect_uri の設定値が workers.dev 側の
    // ホストを指す構成。既知ホスト一覧に無いホストでも設定値から導出して許可する。
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI =
      "https://web.exampleteam.workers.dev/annict";
    const state = encodeWebOAuthState(
      "https://pr-9-web.exampleteam.workers.dev",
      "uuid-1",
    );
    const target = resolveAnnictRelayTarget(
      callbackOn("https://animeishi.uomi.dev", state),
      "https://animeishi.uomi.dev",
    );
    expect(new URL(target ?? "").origin).toBe(
      "https://pr-9-web.exampleteam.workers.dev",
    );
  });

  it("state 欠落・不正 URL は null", () => {
    expect(resolveAnnictRelayTarget(`${PROD}/annict?code=x`, PROD)).toBeNull();
    expect(resolveAnnictRelayTarget("not a url", PROD)).toBeNull();
  });
});
