import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { getAuthMock, loggedInUser, resetAuth } from "@/test-utils/auth";

// EXPO_PUBLIC_ANNICT_CLIENT_ID は useAnnictConnect.ts のモジュール評価時に
// 定数化されるため、import より前に設定する必要がある。jest.mock と同様に
// ホイストされる位置で env を立ててから対象モジュールを require する。
process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID = "test-client-id";
const { useAnnictConnect } = require("@/lib/annict/useAnnictConnect");

// OAuth フローの外部依存（ブラウザ・ディープリンク・乱数・SecureStore・API）はモックし、
// in-flight ガード（連打で openAuthSessionAsync を二重起動しないこと）の挙動だけ検証する。
const mockOpenAuthSession = jest.fn();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));
jest.mock("expo-linking", () => ({
  createURL: () => "animeishi://annict",
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-state",
}));
jest.mock("@/lib/annict/storage", () => ({
  annictTokenStorage: { set: jest.fn(), remove: jest.fn(), get: jest.fn() },
}));
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: { annict: { exchange: { $post: jest.fn() } } },
  },
}));

const { apiClient } = jest.requireMock("@/lib/api") as {
  apiClient: { me: { annict: { exchange: { $post: jest.Mock } } } };
};

const funnelCalls = () =>
  jest
    .mocked(Sentry.logger.info)
    .mock.calls.filter(([message]) => message === ANNICT_FUNNEL_EVENT)
    .map(([, attributes]) => attributes as Record<string, string>);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  // connect 内で Clerk JWT を取得する経路（exchange 呼び出し）を通すため、
  // 既定でサインイン済み + getToken が JWT を返す状態にする。
  loggedInUser();
  getAuthMock().getToken = async () => "clerk_jwt";
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAnnictConnect の in-flight ガード", () => {
  it("連携が進行中の間は二重起動せず、2 回目は cancelled を返す", async () => {
    // 1 回目の openAuthSessionAsync を保留させ、connect を進行中のまま留める。
    let resolveAuth: (v: { type: string }) => void = () => {};
    mockOpenAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );

    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    let firstPromise!: Promise<{ status: string }>;
    act(() => {
      firstPromise = result.current.connect();
      firstPromise.catch(() => {});
    });

    // 進行中に 2 回目を呼ぶ → ブラウザを再度開かず cancelled で返る。
    let secondResult!: { status: string };
    await act(async () => {
      secondResult = await result.current.connect();
    });
    expect(secondResult.status).toBe("cancelled");
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);

    // 1 回目をキャンセルで終わらせてガードを解放する。
    await act(async () => {
      resolveAuth({ type: "cancel" });
      await firstPromise;
    });

    // 解放後は再び連携を開始できる（openAuthSessionAsync が再度呼ばれる）。
    mockOpenAuthSession.mockResolvedValueOnce({ type: "cancel" });
    await act(async () => {
      await result.current.connect();
    });
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(2);
  });

  it("isConnecting は進行中に true、完了後に false へ戻る", async () => {
    let resolveAuth: (v: { type: string }) => void = () => {};
    mockOpenAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );

    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    let p!: Promise<{ status: string }>;
    act(() => {
      p = result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnecting).toBe(true));

    await act(async () => {
      resolveAuth({ type: "cancel" });
      await p;
    });
    expect(result.current.isConnecting).toBe(false);
  });
});

describe("ファネル計測（oauth_result）", () => {
  it("ブラウザでキャンセルされたら cancelled を送る", async () => {
    mockOpenAuthSession.mockResolvedValueOnce({ type: "cancel" });
    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    await act(async () => {
      await result.current.connect({ surface: "watch_history" });
    });

    await waitFor(() => expect(funnelCalls()).toHaveLength(1));
    expect(funnelCalls()[0]).toMatchObject({
      "annict.step": "oauth_result",
      "annict.surface": "watch_history",
      "annict.result": "cancelled",
    });
  });

  it("exchange 失敗で error/exchange_failed を送る", async () => {
    mockOpenAuthSession.mockResolvedValueOnce({
      type: "success",
      url: "animeishi://annict?code=abc&state=test-state",
    });
    apiClient.me.annict.exchange.$post.mockResolvedValueOnce({ ok: false });
    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    await act(async () => {
      await result.current.connect({ surface: "anime_list" });
    });

    await waitFor(() => expect(funnelCalls()).toHaveLength(1));
    expect(funnelCalls()[0]).toMatchObject({
      "annict.step": "oauth_result",
      "annict.surface": "anime_list",
      "annict.result": "error",
      "annict.reason": "exchange_failed",
    });
  });

  it("成功で success を送る。user_key はハッシュ化される", async () => {
    mockOpenAuthSession.mockResolvedValueOnce({
      type: "success",
      url: "animeishi://annict?code=abc&state=test-state",
    });
    apiClient.me.annict.exchange.$post.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: "annict_token" }),
    });
    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    let res: unknown;
    await act(async () => {
      res = await result.current.connect({ surface: "tier_list" });
    });

    expect(res).toEqual({ status: "success" });
    await waitFor(() => expect(funnelCalls()).toHaveLength(1));
    const attrs = funnelCalls()[0];
    expect(attrs).toMatchObject({
      "annict.step": "oauth_result",
      "annict.surface": "tier_list",
      "annict.result": "success",
    });
    // 生の userId は属性に出ない（ハッシュ不可環境では省略される）。
    expect(attrs["annict.user_key"]).not.toBe("user_test");
  });

  it("進行中の再入では oauth_result を送らない", async () => {
    let resolveAuth: (v: { type: string }) => void = () => {};
    mockOpenAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const { result } = renderHook(() => useAnnictConnect(), { wrapper });

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.connect({ surface: "anime_list" });
    });
    await act(async () => {
      await result.current.connect({ surface: "anime_list" });
    });

    await act(async () => {
      resolveAuth({ type: "cancel" });
      await first;
    });

    await waitFor(() => expect(funnelCalls()).toHaveLength(1));
    expect(funnelCalls()[0]["annict.result"]).toBe("cancelled");
  });
});
