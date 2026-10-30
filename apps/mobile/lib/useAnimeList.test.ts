import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAnimeList,
  usePrefetchSeasonWorks,
  useSortedAnimeList,
} from "@/lib/useAnimeList";
import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";

// Annict 連携（SecureStore トークン / 連携状態）と apiClient をモックし、
// useAnimeList のサーバー検索フロー（クエリ駆動の取得・レスポンス整形）を検証する。
// jest.mock のファクトリは巻き上げられるため、参照する変数は mock 接頭辞が必須。
const mockSearchGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    works: { search: { $get: (...args: unknown[]) => mockSearchGet(...args) } },
  },
}));

const mockBuildAnnictAuthHeader = jest.fn();
let mockIsConnected = true;
let mockIsConnectionLoading = false;
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: () => mockBuildAnnictAuthHeader(),
  // 実装では読み込み中は connected が未確定（isConnected=false）になる。
  // useAnimeList は isConnected でフェッチを gate するため、
  // モックでも同じ契約（loading 中は isConnected=false）に揃える。
  useAnnictConnection: () => ({
    isConnected: mockIsConnectionLoading ? false : mockIsConnected,
    isLoading: mockIsConnectionLoading,
  }),
}));

function makeWrapper(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
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
    malAnimeId: null,
    resolvedImageUrl: null,
    hostedImageUrl: null,
    genres: null,
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
    malAnimeId: null,
    resolvedImageUrl: null,
    hostedImageUrl: null,
    genres: null,
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
    malAnimeId: null,
    resolvedImageUrl: null,
    hostedImageUrl: null,
    genres: null,
  },
];

describe("useSortedAnimeList", () => {
  describe("ソート", () => {
    it("タイトル昇順でソートする", async () => {
      const { result } = await renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "asc"),
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["HUNTER×HUNTER", "鬼滅の刃", "進撃の巨人"]);
    });

    it("タイトル降順でソートする", async () => {
      const { result } = await renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "title", "desc"),
      );
      const titles = result.current.map((a) => a.title);
      expect(titles).toEqual(["進撃の巨人", "鬼滅の刃", "HUNTER×HUNTER"]);
    });

    it("年度昇順でソートする", async () => {
      const { result } = await renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "asc"),
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2011, 2013, 2019]);
    });

    it("年度降順でソートする", async () => {
      const { result } = await renderHook(() =>
        useSortedAnimeList(MOCK_WORKS, "year", "desc"),
      );
      const years = result.current.map((a) => a.seasonYear);
      expect(years).toEqual([2019, 2013, 2011]);
    });

    it("元の配列を破壊しない", async () => {
      const original = [...MOCK_WORKS];
      await renderHook(() => useSortedAnimeList(MOCK_WORKS, "title", "asc"));
      expect(MOCK_WORKS).toEqual(original);
    });
  });

  describe("エッジケース", () => {
    it("data が undefined のとき空配列を返す", async () => {
      const { result } = await renderHook(() =>
        useSortedAnimeList(undefined, "title", "asc"),
      );
      expect(result.current).toHaveLength(0);
    });
  });
});

describe("useAnimeList", () => {
  beforeEach(async () => {
    resetAuth();
    mockSearchGet.mockReset();
    mockBuildAnnictAuthHeader.mockReset();
    mockIsConnected = true;
    mockIsConnectionLoading = false;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockBuildAnnictAuthHeader.mockResolvedValue({
      "X-Annict-Token": "annict_tok",
    });
  });

  it("検索語が空のときは今期アニメ（season）を title なしで取得する", async () => {
    mockSearchGet.mockResolvedValue(
      okSearchResponse({
        works: [
          { annictWorkId: 99, nodeId: "n99", state: null, title: "今期アニメ" },
        ],
        hasNextPage: false,
        endCursor: null,
      }),
    );

    const { result } = await renderHook(() => useAnimeList(""), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.isSeason).toBe(true);
    expect(result.current.data?.[0].title).toBe("今期アニメ");
    // 検索語が空なので title を載せない（サーバーが今期シーズンを既定にする）。
    const [arg] = mockSearchGet.mock.calls[0];
    expect(arg.query.title).toBeUndefined();
  });

  it("未連携のうちはフェッチせず isConnected=false を返す", async () => {
    mockIsConnected = false;
    const { result } = await renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it("連携状態の読み込み中は isConnectionLoading=true を返しフェッチしない", async () => {
    mockIsConnectionLoading = true;
    const { result } = await renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });
    expect(mockSearchGet).not.toHaveBeenCalled();
    expect(result.current.isConnectionLoading).toBe(true);
  });

  it("サインアウト中はフェッチしない", async () => {
    signedOutUser();
    await renderHook(() => useAnimeList("進撃"), { wrapper: makeWrapper() });
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
      }),
    );

    const { result } = await renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].title).toBe("進撃の巨人");
    // ページング情報を落とさず公開する。
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.endCursor).toBe("cur1");

    // 検索結果は今期アニメ初期表示ではない。
    expect(result.current.isSeason).toBe(false);
    // title / X-Annict-Token を載せて呼んでいる。
    const [arg, opts] = mockSearchGet.mock.calls[0];
    expect(arg.query.title).toBe("進撃");
    expect(opts.headers["X-Annict-Token"]).toBe("annict_tok");
  });

  it("シーズン検索で hasNextPage があれば after で自動追い読みし結果を連結する", async () => {
    // サーバー側のページ上限に達した場合（hasNextPage=true + endCursor）でも
    // 表示が途中で打ち切られないよう、次ページを自動で辿る。
    mockSearchGet
      .mockResolvedValueOnce(
        okSearchResponse({
          works: [
            { annictWorkId: 1, nodeId: "n1", state: null, title: "作品A" },
          ],
          hasNextPage: true,
          endCursor: "cur1",
        }),
      )
      .mockResolvedValueOnce(
        okSearchResponse({
          works: [
            { annictWorkId: 2, nodeId: "n2", state: null, title: "作品B" },
          ],
          hasNextPage: false,
          endCursor: null,
        }),
      );

    const { result } = await renderHook(() => useAnimeList("", "2026-spring"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.map((w) => w.title)).toEqual([
      "作品A",
      "作品B",
    ]);
    expect(result.current.hasNextPage).toBe(false);
    expect(mockSearchGet).toHaveBeenCalledTimes(2);
    // 2 ページ目は endCursor を after に載せて継続取得する
    const [first] = mockSearchGet.mock.calls[0];
    const [second] = mockSearchGet.mock.calls[1];
    expect(first.query.season).toBe("2026-spring");
    expect(first.query.after).toBeUndefined();
    expect(second.query.season).toBe("2026-spring");
    expect(second.query.after).toBe("cur1");
  });

  it("タイトル検索では hasNextPage があっても自動追い読みしない", async () => {
    // 広い語で全件走査すると際限がないため、タイトル検索は先頭ページのみ。
    mockSearchGet.mockResolvedValue(
      okSearchResponse({
        works: [
          { annictWorkId: 1, nodeId: "n1", state: null, title: "進撃の巨人" },
        ],
        hasNextPage: true,
        endCursor: "cur1",
      }),
    );

    const { result } = await renderHook(() => useAnimeList("進撃"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    // 追い読みが起きないことを確認するため少し待つ
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSearchGet).toHaveBeenCalledTimes(1);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.endCursor).toBe("cur1");
  });
});

describe("usePrefetchSeasonWorks", () => {
  beforeEach(async () => {
    resetAuth();
    mockSearchGet.mockReset();
    mockBuildAnnictAuthHeader.mockReset();
    mockIsConnected = true;
    mockIsConnectionLoading = false;
    loggedInUser();
    setMockClerkState({ getToken: async () => "clerk_jwt" });
    mockBuildAnnictAuthHeader.mockResolvedValue({
      "X-Annict-Token": "annict_tok",
    });
  });

  it("enabled のとき指定シーズンを season 検索でプリフェッチする", async () => {
    mockSearchGet.mockResolvedValue(
      okSearchResponse({ works: [], hasNextPage: false, endCursor: null }),
    );

    await renderHook(
      () => usePrefetchSeasonWorks(["2026-summer", "2027-winter"], true),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(mockSearchGet).toHaveBeenCalledTimes(2));
    const seasons = mockSearchGet.mock.calls.map(([arg]) => arg.query.season);
    expect(seasons).toEqual(["2026-summer", "2027-winter"]);
    // title 検索ではなくシーズン検索として叩く。
    for (const [arg] of mockSearchGet.mock.calls) {
      expect(arg.query.title).toBeUndefined();
    }
    // Annict トークンヘッダも載る。
    const [, opts] = mockSearchGet.mock.calls[0];
    expect(opts.headers["X-Annict-Token"]).toBe("annict_tok");
  });

  it("enabled=false ならプリフェッチしない", async () => {
    await renderHook(() => usePrefetchSeasonWorks(["2026-summer"], false), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("Annict 未連携ならプリフェッチしない", async () => {
    mockIsConnected = false;
    await renderHook(() => usePrefetchSeasonWorks(["2026-summer"], true), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("サインアウト中はプリフェッチしない", async () => {
    signedOutUser();
    await renderHook(() => usePrefetchSeasonWorks(["2026-summer"], true), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("seasons が空なら何もしない", async () => {
    await renderHook(() => usePrefetchSeasonWorks([], true), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSearchGet).not.toHaveBeenCalled();
  });

  it("プリフェッチが失敗したときデータを持たないエラーエントリを残さない", async () => {
    // 失敗エントリが残ると、後でそのシーズンへ切り替えた画面が
    // 自動リフェッチ中ずっとエラー表示になるため除去対象にする。
    // gcTime 既定値のままにしないと GC が先に消して検証にならない。
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSearchGet.mockRejectedValue(new Error("network error"));

    await renderHook(() => usePrefetchSeasonWorks(["2026-summer"], true), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(mockSearchGet).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        client.getQueryState(["works", "search", "season", "2026-summer"]),
      ).toBeUndefined(),
    );
  });

  it("プリフェッチの再取得が失敗してもデータを持つ既存エントリは消さない", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["works", "search", "season", "2026-summer"];
    const cached = {
      pages: [{ works: MOCK_WORKS, hasNextPage: false, endCursor: null }],
      pageParams: [undefined],
    };
    client.setQueryData(key, cached);
    mockSearchGet.mockRejectedValue(new Error("network error"));

    await renderHook(() => usePrefetchSeasonWorks(["2026-summer"], true), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(mockSearchGet).toHaveBeenCalledTimes(1));
    // 再取得が失敗して error 状態になっても、データを持つエントリは消さず
    // 一覧にはキャッシュ済みの作品が出せる。
    await waitFor(() =>
      expect(client.getQueryState(key)?.status).toBe("error"),
    );
    expect(client.getQueryData(key)).toEqual(cached);
  });
});
