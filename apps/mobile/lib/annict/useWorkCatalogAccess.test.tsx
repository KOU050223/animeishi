import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWorkCatalogAccess } from "./useWorkCatalogAccess";

const mockCatalogStatusGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: {
      "catalog-status": {
        $get: (...a: unknown[]) => mockCatalogStatusGet(...a),
      },
    },
  },
}));

let mockConnection = { isConnected: false, isLoading: false };
jest.mock("./useAnnictConnection", () => ({
  useAnnictConnection: () => mockConnection,
}));

let mockIsSignedIn = true;
jest.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isSignedIn: mockIsSignedIn,
    getToken: async () => "clerk_jwt",
  }),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function catalogStatus(sharedCatalogAvailable: boolean) {
  return { ok: true, json: async () => ({ sharedCatalogAvailable }) };
}

describe("useWorkCatalogAccess（issue #561）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = { isConnected: false, isLoading: false };
    mockIsSignedIn = true;
    mockCatalogStatusGet.mockResolvedValue(catalogStatus(true));
  });

  it("未連携でも共用トークンがあれば作品情報を使える", async () => {
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canBrowseWorks).toBe(true);
    expect(result.current.isConnected).toBe(false);
  });

  it("未連携で共用トークンが無ければ使えない（連携誘導を出す）", async () => {
    mockCatalogStatusGet.mockResolvedValue(catalogStatus(false));
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canBrowseWorks).toBe(false);
  });

  it("共用トークンの有無を確認できなければ使えない扱いにする", async () => {
    mockCatalogStatusGet.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canBrowseWorks).toBe(false);
  });

  it("確認が済むまでは isLoading=true（ゲートを出さない）", async () => {
    mockCatalogStatusGet.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.canBrowseWorks).toBe(false);
  });

  it("連携済みなら共用トークンの有無を問い合わせずに使える", async () => {
    mockConnection = { isConnected: true, isLoading: false };
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toEqual({
      canBrowseWorks: true,
      isConnected: true,
      isLoading: false,
    });
    expect(mockCatalogStatusGet).not.toHaveBeenCalled();
  });

  it("連携状態の読み込み中は問い合わせず isLoading=true", async () => {
    mockConnection = { isConnected: false, isLoading: true };
    const { result } = await renderHook(() => useWorkCatalogAccess(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(mockCatalogStatusGet).not.toHaveBeenCalled();
  });
});
