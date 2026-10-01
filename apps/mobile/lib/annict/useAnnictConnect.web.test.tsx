/**
 * @jest-environment jsdom
 */
import { createElement } from "react";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Web 実装を直接 import して検証する（バンドラの .web 解決に依存せず単体で確認）。
import {
  useAnnictConnect,
  ANNICT_STATE_STORAGE_KEY,
} from "@/lib/annict/useAnnictConnect.web";

const mockDisconnectPost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      annict: {
        disconnect: { $post: (...a: unknown[]) => mockDisconnectPost(...a) },
      },
    },
  },
}));

jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: async () => "clerk_jwt" }),
}));

// EXPO_PUBLIC_ANNICT_CLIENT_ID をテスト用に設定する。
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID;
const ORIGINAL_WEB_REDIRECT = process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useAnnictConnect (web)", () => {
  let hrefValue = "";
  const originalLocation = window.location;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID = "test_client_id";
    delete process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI;
    mockDisconnectPost.mockReset().mockResolvedValue({ ok: true });
    window.sessionStorage.clear();
    hrefValue = "";
    // jsdom によっては crypto.randomUUID が無いため、テスト用に固定値を注入する。
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {
          ...globalThis.crypto,
          randomUUID: () => "test-state-uuid",
        },
      });
    }
    // jsdom の location は読み取り専用のため、href の getter/setter を差し替えて
    // 遷移先 URL を捕捉する（origin は既定の http://localhost を使う）。
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: originalLocation.origin,
        get href() {
          return hrefValue;
        },
        set href(v: string) {
          hrefValue = v;
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID = ORIGINAL_ENV;
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI = ORIGINAL_WEB_REDIRECT;
  });

  it("connect: state を sessionStorage に保存し authorize へ遷移する", async () => {
    const { result } = renderHook(() => useAnnictConnect(), {
      wrapper: makeWrapper(),
    });

    let res: Awaited<ReturnType<typeof result.current.connect>> | undefined;
    await act(async () => {
      res = await result.current.connect();
    });

    expect(res).toEqual({ status: "success" });
    // state が退避されている。
    const state = window.sessionStorage.getItem(ANNICT_STATE_STORAGE_KEY);
    expect(state).toBeTruthy();
    // authorize URL へ遷移し、退避した state と redirect_uri を含む。
    expect(hrefValue).toContain("https://api.annict.com/oauth/authorize");
    expect(hrefValue).toContain(`state=${state}`);
    expect(hrefValue).toContain("client_id=test_client_id");
    expect(hrefValue).toContain(encodeURIComponent("/annict"));
  });

  it("connect: state に戻り先オリジンを埋め込む（正規側での中継用）", async () => {
    const { result } = renderHook(() => useAnnictConnect(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.connect();
    });

    // state は <base64url(origin)>.<uuid> 形式で sessionStorage に退避され、
    // authorize URL の state パラメータと一致する。
    const state = window.sessionStorage.getItem(ANNICT_STATE_STORAGE_KEY);
    const [encodedOrigin, random] = (state ?? "").split(".");
    expect(Buffer.from(encodedOrigin, "base64url").toString()).toBe(
      "http://localhost",
    );
    expect(random).toBeTruthy();
    const authorizeUrl = new URL(hrefValue);
    expect(authorizeUrl.searchParams.get("state")).toBe(state);
    // 未設定時は現在オリジンが redirect_uri になる。
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/annict",
    );
  });

  it("connect: EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI があればそれを redirect_uri に使う", async () => {
    process.env.EXPO_PUBLIC_ANNICT_WEB_REDIRECT_URI =
      "https://animeishi-web-production.uozumi05.workers.dev/annict";
    const { result } = renderHook(() => useAnnictConnect(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.connect();
    });

    const authorizeUrl = new URL(hrefValue);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "https://animeishi-web-production.uozumi05.workers.dev/annict",
    );
    // 戻り先は実行中のオリジン（ここでは jsdom の http://localhost）。
    const state = authorizeUrl.searchParams.get("state") ?? "";
    const [encodedOrigin] = state.split(".");
    expect(Buffer.from(encodedOrigin, "base64url").toString()).toBe(
      "http://localhost",
    );
  });

  it("disconnect: サーバーの disconnect を Clerk JWT 付きで呼ぶ", async () => {
    const { result } = renderHook(() => useAnnictConnect(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.disconnect();
    });

    await waitFor(() => expect(mockDisconnectPost).toHaveBeenCalledTimes(1));
    const [, options] = mockDisconnectPost.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer clerk_jwt");
  });
});
