import {
  buildAuthorizeUrl,
  parseAuthCallback,
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
    expect(`${parsed.origin}${parsed.pathname}`).toBe(ANNICT_AUTHORIZE_ENDPOINT);
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
