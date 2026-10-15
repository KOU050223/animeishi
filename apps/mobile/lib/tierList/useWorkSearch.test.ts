import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWorkSearch } from "./useWorkSearch";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/clerk-expo";

// Annict 連携（SecureStore トークン / 連携状態）と apiClient をモックし、
// useWorkSearch のタイトル検索フロー（発火条件・クエリ・レスポンス整形）を検証する。
// jest.mock のファクトリは巻き上げられるため、参照する変数は mock 接頭辞が必須。
const mockSearchGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: { search: { $get: (...args: unknown[]) => mockSearchGet(...args) } },
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

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function okSearchResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

const SEARCH_RESULT = {
  works: [
    {
      annictWorkId: 1,
      nodeId: "n1",
      state: null,
      title: "進撃の巨人",
      titleKana: "しんげきのきょじん",
      titleEn: "Attack on Titan",
      seasonYear: 2013,
      seasonName: "2013-spring",
      imageUrl: null,
      malAnimeId: null,
      resolvedImageUrl: null,
    },
  ],
  hasNextPage: false,
  endCursor: null,
};

describe("useWorkSearch", () => {
  beforeEach(() => {
    resetAuth();
    mockSearchGet.mockReset();
    mockBuildAnnictAuthHeader.mockReset();
    mockIsConnected = true;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockBuildAnnictAuthHeader.mockResolvedValue({
      "X-Annict-Token": "annict_tok",
    });
    mockSearchGet.mockResolvedValue(okSearchResponse(SEARCH_RESULT));
  });

  it("検索語が空の間はフェッチしない", async () => {
    const { result } = renderHook(() => useWorkSearch(""), {
      wrapper: makeWrapper(),
    });
    // 発火しないことを確認するため少し待つ
    await new Promise((r) => setTimeout(r, 350));
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.hasQuery).toBe(false);
    expect(result.current.works).toHaveLength(0);
  });

  it("空白だけの検索語でもフェッチしない", async () => {
    renderHook(() => useWorkSearch("   "), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 350));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("検索語ありで works/search を title で叩き、works を返す", async () => {
    const { result } = renderHook(() => useWorkSearch("進撃"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.works).toHaveLength(1));
    expect(result.current.works[0].title).toBe("進撃の巨人");
    expect(result.current.hasQuery).toBe(true);

    const [arg, opts] = mockSearchGet.mock.calls[0];
    // title 検索なので season は載せない
    expect(arg.query).toEqual({ title: "進撃" });
    expect(opts.headers["X-Annict-Token"]).toBe("annict_tok");
    expect(opts.headers.Authorization).toBe("Bearer clerk_jwt");
  });

  it("入力中に語が変わるとデバウンスされ、最後の語でだけ検索する", async () => {
    // "" → "進" → "進撃" を同一 tick で書き換える。デバウンス後の値が
    // 空のまま保たれるため中間の語ではフェッチが走らない。
    const { rerender } = renderHook(({ q }) => useWorkSearch(q), {
      wrapper: makeWrapper(),
      initialProps: { q: "" },
    });
    rerender({ q: "進" });
    rerender({ q: "進撃" });

    await waitFor(() => expect(mockSearchGet).toHaveBeenCalled());
    expect(mockSearchGet).toHaveBeenCalledTimes(1);
    const [arg] = mockSearchGet.mock.calls[0];
    expect(arg.query.title).toBe("進撃");
  });

  it("未連携のうちはフェッチしない", async () => {
    mockIsConnected = false;
    renderHook(() => useWorkSearch("進撃"), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 350));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    renderHook(() => useWorkSearch("進撃"), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 350));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });
});
