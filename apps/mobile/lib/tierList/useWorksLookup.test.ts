import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWorksLookup } from "./useWorksLookup";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";

// apiClient の /works/lookup 呼び出しをモックし、ID まとめ解決の
// バッチ分割（50 件上限）と結果の連結順を検証する。
const mockLookupGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: { lookup: { $get: (...args: unknown[]) => mockLookupGet(...args) } },
  },
}));

const mockBuildAnnictAuthHeader = jest.fn();
let mockIsConnected = true;
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: () => mockBuildAnnictAuthHeader(),
  useAnnictConnection: () => ({
    isConnected: mockIsConnected,
    isLoading: false,
  }),
}));

function makeWrapper(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  }),
) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function workOf(id: number) {
  return { annictWorkId: id, title: `作品${id}` };
}

describe("useWorksLookup", () => {
  beforeEach(async () => {
    resetAuth();
    mockLookupGet.mockReset();
    mockBuildAnnictAuthHeader.mockReset();
    mockIsConnected = true;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockBuildAnnictAuthHeader.mockResolvedValue({
      "X-Annict-Token": "annict_tok",
    });
    mockLookupGet.mockImplementation((arg: { query: { ids: string } }) =>
      Promise.resolve(
        okResponse({
          works: arg.query.ids.split(",").map((id) => workOf(Number(id))),
        }),
      ),
    );
  });

  it("ids が空の間はフェッチしない", async () => {
    await renderHook(() => useWorksLookup([]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });

  it("ids を /works/lookup に渡し、works を ID 順で返す", async () => {
    const { result } = await renderHook(() => useWorksLookup([3, 1, 2]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.works).toHaveLength(3));
    expect(mockLookupGet).toHaveBeenCalledTimes(1);
    const [arg, opts] = mockLookupGet.mock.calls[0];
    expect(arg.query).toEqual({ ids: "3,1,2" });
    expect(opts.headers["X-Annict-Token"]).toBe("annict_tok");
    expect(opts.headers.Authorization).toBe("Bearer clerk_jwt");
    expect(result.current.data?.works.map((w) => w.annictWorkId)).toEqual([
      3, 1, 2,
    ]);
  });

  it("51 件以上の ids は 50 件ずつのバッチに分けて取得し、元の並びで連結する", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const { result } = await renderHook(() => useWorksLookup(ids), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.works).toHaveLength(120));
    expect(mockLookupGet).toHaveBeenCalledTimes(3);
    const batchSizes = mockLookupGet.mock.calls.map(
      ([arg]) => arg.query.ids.split(",").length,
    );
    expect(batchSizes).toEqual([50, 50, 20]);
    expect(result.current.data?.works.map((w) => w.annictWorkId)).toEqual(ids);
  });

  it("途中のバッチが失敗したらエラーになる", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    mockLookupGet
      .mockImplementationOnce((arg: { query: { ids: string } }) =>
        Promise.resolve(
          okResponse({
            works: arg.query.ids.split(",").map((id) => workOf(Number(id))),
          }),
        ),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      });

    const { result } = await renderHook(() => useWorksLookup(ids), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("未連携のうちはフェッチしない", async () => {
    mockIsConnected = false;
    await renderHook(() => useWorksLookup([1]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    await renderHook(() => useWorksLookup([1]), { wrapper: makeWrapper() });
    expect(mockLookupGet).not.toHaveBeenCalled();
  });
});
