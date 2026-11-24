/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { waitFor } from "@testing-library/react-native";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { ApiRequestError } from "@/lib/apiError";
import {
  exchangeAnnictWebCallback,
  ANNICT_STATE_STORAGE_KEY,
  ANNICT_FUNNEL_SURFACE_STORAGE_KEY,
} from "@/lib/annict/useAnnictConnect.web";

const mockExchangePost = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      annict: {
        exchange: { $post: (...a: unknown[]) => mockExchangePost(...a) },
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

function setOrigin(origin: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin },
  });
}

const getClerkToken = async () => "clerk_jwt";

describe("exchangeAnnictWebCallback", () => {
  const STATE = "state-abc";
  const CALLBACK = `https://animeishi.uomi.dev/annict?code=auth_code&state=${STATE}`;
  const ORIGINAL_WEB_REDIRECT = process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;

  beforeEach(async () => {
    mockExchangePost.mockReset();
    jest.mocked(captureAnalyticsEvent).mockClear();
    window.sessionStorage.clear();
    setOrigin("https://animeishi.uomi.dev");
    delete process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;
  });

  afterEach(async () => {
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI = ORIGINAL_WEB_REDIRECT;
  });

  it("state 一致で exchange(mode:web) を叩き success を返す", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    mockExchangePost.mockResolvedValue({ ok: true });

    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken);

    expect(res).toEqual({ status: "success" });
    expect(mockExchangePost).toHaveBeenCalledTimes(1);
    const [payload, options] = mockExchangePost.mock.calls[0];
    expect(payload.json.code).toBe("auth_code");
    expect(payload.json.mode).toBe("web");
    expect(payload.json.redirectUri).toBe("https://animeishi.uomi.dev/annict");
    // 認証ヘッダの組み立ては apiFetch に委譲したため fetch オプションのみ。
    expect(options.fetch).toEqual(expect.any(Function));
    // 使い終わった state は消費される。
    expect(window.sessionStorage.getItem(ANNICT_STATE_STORAGE_KEY)).toBeNull();
  });

  it("EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI 設定時はそれを exchange に渡す", async () => {
    // プレビュー等では authorize 時の redirect_uri（正規の登録済み URL）を
    // exchange にも送る必要がある（Annict が両者の一致を検証するため）。
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI =
      "https://animeishi-web-production.uozumi05.workers.dev/annict";
    // プレビューオリジン上でコールバックを処理する想定。
    setOrigin("https://pr-1-animeishi-web-production.uozumi05.workers.dev");
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    mockExchangePost.mockResolvedValue({ ok: true });

    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken);

    expect(res).toEqual({ status: "success" });
    const [payload] = mockExchangePost.mock.calls[0];
    expect(payload.json.redirectUri).toBe(
      "https://animeishi-web-production.uozumi05.workers.dev/annict",
    );
  });

  it("退避 state が無ければ state_mismatch（exchange を叩かない）", async () => {
    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken);
    expect(res).toEqual({ status: "error", reason: "state_mismatch" });
    expect(mockExchangePost).not.toHaveBeenCalled();
  });

  it("state 不一致では state_mismatch（exchange を叩かない）", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, "different");
    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken);
    expect(res).toEqual({ status: "error", reason: "state_mismatch" });
    expect(mockExchangePost).not.toHaveBeenCalled();
  });

  it("exchange が失敗したら exchange_failed", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    // apiFetch は HTTP 失敗を ApiRequestError に変換して投げる。
    mockExchangePost.mockRejectedValue(new ApiRequestError(500, "boom"));
    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken);
    expect(res).toEqual({ status: "error", reason: "exchange_failed" });
  });

  it("Clerk トークンが無ければ unauthorized", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    const res = await exchangeAnnictWebCallback(CALLBACK, async () => null);
    expect(res).toEqual({ status: "error", reason: "unauthorized" });
    expect(mockExchangePost).not.toHaveBeenCalled();
  });

  it("URL の error パラメータはそのまま理由に載る", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    const denied =
      "https://animeishi.uomi.dev/annict?error=access_denied&state=" + STATE;
    const res = await exchangeAnnictWebCallback(denied, getClerkToken);
    expect(res).toEqual({ status: "error", reason: "access_denied" });
  });

  it("結果を oauth_result イベントとして送り、退避した surface を引き継ぐ", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    window.sessionStorage.setItem(
      ANNICT_FUNNEL_SURFACE_STORAGE_KEY,
      "anime_list",
    );
    mockExchangePost.mockResolvedValue({ ok: true });

    const res = await exchangeAnnictWebCallback(CALLBACK, getClerkToken, {
      getUserId: () => "user_web",
    });

    expect(res).toEqual({ status: "success" });
    await waitFor(() =>
      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        ANNICT_FUNNEL_EVENT,
        expect.objectContaining({
          "annict.step": "oauth_result",
          "annict.surface": "anime_list",
          "annict.result": "success",
        }),
      ),
    );
    // 使い終わった surface は消費される。
    expect(
      window.sessionStorage.getItem(ANNICT_FUNNEL_SURFACE_STORAGE_KEY),
    ).toBeNull();
  });

  it("未知の surface 値は属性に出さない", async () => {
    window.sessionStorage.setItem(ANNICT_STATE_STORAGE_KEY, STATE);
    window.sessionStorage.setItem(
      ANNICT_FUNNEL_SURFACE_STORAGE_KEY,
      "not_a_surface",
    );
    mockExchangePost.mockResolvedValue({ ok: true });

    await exchangeAnnictWebCallback(CALLBACK, getClerkToken);

    await waitFor(() =>
      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        ANNICT_FUNNEL_EVENT,
        expect.objectContaining({ "annict.result": "success" }),
      ),
    );
    // waitFor で呼び出し済みが保証されている。
    const [, attributes] = jest.mocked(captureAnalyticsEvent).mock.calls[0]!;
    expect(attributes["annict.surface"]).toBeUndefined();
  });
});
