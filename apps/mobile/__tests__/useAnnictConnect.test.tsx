import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// EXPO_PUBLIC_ANNICT_CLIENT_ID は useAnnictConnect.ts のモジュール評価時に
// 定数化されるため、import より前に設定する必要がある。jest.mock と同様に
// ホイストされる位置で env を立ててから対象モジュールを require する。
process.env.EXPO_PUBLIC_ANNICT_CLIENT_ID = "test-client-id";
// eslint-disable-next-line @typescript-eslint/no-require-imports
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

beforeEach(() => {
  jest.clearAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
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
