/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Web 実装を直接 import して検証する（バンドラの .web 解決に依存せず単体で確認）。
import { useAnnictConnection } from "@/lib/annict/useAnnictConnection.web";

const mockAnnictGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      annict: { $get: (...a: unknown[]) => mockAnnictGet(...a) },
    },
  },
}));

// Clerk の認証状態をテストごとに切り替えられるよう変数経由で返す。
let mockAuth: {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
} = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_1",
  getToken: async () => "clerk_jwt",
};
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => mockAuth,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useAnnictConnection (web)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuth = {
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
      getToken: async () => "clerk_jwt",
    };
    mockAnnictGet.mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true }),
    });
  });

  it("サインイン済みで connected が返れば isConnected=true になる", async () => {
    const { result } = await renderHook(() => useAnnictConnection(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(mockAnnictGet).toHaveBeenCalledTimes(1);
  });

  it("Clerk のセッション復元中（isLoaded=false）は未確定として isLoading=true を返す", async () => {
    // enabled=false のため query.isLoading は立たず、クエリは発行されない。
    // この区間で「未連携」とみなすと連携済みユーザーに連携カード等が一瞬出る。
    mockAuth = { ...mockAuth, isLoaded: false, isSignedIn: false };
    const { result } = await renderHook(() => useAnnictConnection(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(mockAnnictGet).not.toHaveBeenCalled();
  });

  it("未サインインでは問い合わせず isConnected=false / isLoading=false", async () => {
    mockAuth = { ...mockAuth, isSignedIn: false, userId: null };
    const { result } = await renderHook(() => useAnnictConnection(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(mockAnnictGet).not.toHaveBeenCalled();
  });

  it("サーバーが connected=false を返せば isConnected=false", async () => {
    mockAnnictGet.mockResolvedValue({
      ok: true,
      json: async () => ({ connected: false }),
    });
    const { result } = await renderHook(() => useAnnictConnection(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConnected).toBe(false);
  });
});
