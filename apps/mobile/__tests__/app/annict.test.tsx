/**
 * @jest-environment jsdom
 */
import {
  exchangeAnnictWebCallback,
  ANNICT_STATE_STORAGE_KEY,
} from "@/lib/annict/useAnnictConnect.web";

const mockExchangePost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      annict: {
        exchange: { $post: (...a: unknown[]) => mockExchangePost(...a) },
      },
    },
  },
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

  beforeEach(() => {
    mockExchangePost.mockReset();
    window.sessionStorage.clear();
    setOrigin("https://animeishi.uomi.dev");
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
    expect(options.headers.Authorization).toBe("Bearer clerk_jwt");
    // 使い終わった state は消費される。
    expect(window.sessionStorage.getItem(ANNICT_STATE_STORAGE_KEY)).toBeNull();
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
    mockExchangePost.mockResolvedValue({ ok: false });
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
});
