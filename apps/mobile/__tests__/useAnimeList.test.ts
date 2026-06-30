import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAnimeList, useSortedAnimeList } from "@/lib/useAnimeList";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/clerk-expo";

// Annict 連携（SecureStore トークン / 連携状態）と apiClient をモックし、
// useAnimeList のサーバー検索フロー（クエリ駆動の取得・レスポンス整形）を検証する。
// jest.mock のファクトリは巻き上げられるため、参照する変数は mock 接頭辞が必須。
const mockSearchGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: { search: { $get: (...args: unknown[]) => mockSearchGet(...args) } },
  },
}));

const mockGetAnnictToken = jest.fn();
let mockIsConnected = true;
let mockIsConnectionLoading = false;
jest.mock("@/lib/annict", () => ({
  getAnnictToken: () => mockGetAnnictToken(),
  useAnnictConnection: () => ({
    isConnected: mockIsConnected,
    isLoading: mockIsConnectionLoading,
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

const MOCK_WORKS = [
  {
    annictWorkId: 1,
    nodeId: "node-1",
    state: null,
    title: "進撃の巨人",
    titleKana: "しんげきのきょじん",
    titleEn: "Attack on Titan",
    seasonYear: 2013,
    seasonName: "2013-spring",
    imageUrl: null,
  },
  {
    annictWorkId: 2,
    nodeId: "node-2",
    state: null,
    title: "鬼滅の刃",
    titleKana: "きめつのやいば",
    titleEn: "Demon Slayer",
    seasonYear: 2019,
    seasonName: "2019-spring",
    imageUrl: null,
  },
  {
    annictWorkId: 3,
    nodeId: "node-3",
    state: null,
    title: "HUNTER×HUNTER",
    titleKana: "はんたーはんたー",
    titleEn: "Hunter x Hunter",
    seasonYear: 2011,
    seasonName: "2011-fall",
    imageUrl: null,
  },
];

describe("useSortedAnimeList", () => {
  describe("ソート", () => {
    it("タイトル昇順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "asc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["HUNTER×HUNTER", "鬼滅の刃", "進撃の巨人"]);
    });

    it("タイトル降順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "desc")
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["進撃の巨人", "鬼滅の刃", "HUNTER×HUNTER"]);
    });

    it("年度昇順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "asc")
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2011, 2013, 2019]);
    });

    it("年度降順でソートする", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "desc")
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2019, 2013, 2011]);
    });

    it("元の配列を破壊しない", () => {
      const original = [...MOCK_WORKS];
      renderHook(() => useSortedAnimeList(MOCK_WORKS, "title", "asc"));
      expect(MOCK_WORKS).toEqual(original);
    });
  });

  describe("エッジケース", () => {
    it("data が undefined のとき空配列を返す", () => {
      const { result } = renderHook(() =>
        useSortedAnimeList(undefined, "title", "asc")
      );
      expect(result.current).toHaveLength(0);
    });
  });
});

describe("useAnimeList", () => {
  beforeEach(() => {
    resetAuth();
    mockSearchGet.mockReset();
    mockGetAnnictToken.mockReset();
    mockIsConnected = true;
    mockIsConnectionLoading = false;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockGetAnnictToken.mockResolvedValue("annict_tok");
  });

  it("検索語が空のうちはフェッチしない（enabled=false）", () => {
    const { result } = renderHook(() => useAnimeList(""), {
      wrapper: makeWrapper(),
    });
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("未連携のうちはフェッチせず isConnected=false を返す", () => {
    mockIsConnected = false;
    const { result } = renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it("連携状態の読み込み中は isConnectionLoading=true を返しフェッチしない", () => {
    mockIsConnectionLoading = true;
    const { result } = renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.isConnectionLoading).toBe(true);
  });

  it("サインアウト中はフェッチしない", () => {
    signedOutUser();
    renderHook(() => useAnimeList("進撃"), { wrapper: makeWrapper() });
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("検索語ありで works/search を叩き、works を data として返す", async () => {
    mockSearchGet.mockResolvedValue(
      okSearchResponse({
        works: [
          { annictWorkId: 1, nodeId: "n1", state: null, title: "進撃の巨人" },
        ],
        hasNextPage: true,
        endCursor: "cur1",
      })
    );

    const { result } = renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].title).toBe("進撃の巨人");
    // ページング情報を落とさず公開する。
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.endCursor).toBe("cur1");

    // title / X-Annict-Token を載せて呼んでいる。
    const [arg, opts] = mockSearchGet.mock.calls[0];
    expect(arg.query.title).toBe("進撃");
    expect(opts.headers["X-Annict-Token"]).toBe("annict_tok");
  });
});
