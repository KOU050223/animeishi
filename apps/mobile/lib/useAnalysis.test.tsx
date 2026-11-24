import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ANALYSIS_QUERY_KEY,
  useAnalysis,
  useGenerateAnalysis,
} from "@/lib/useAnalysis";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockWatchHistoryGet = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      analysis: {
        $get: (...args: unknown[]) => mockGet(...args),
        $post: (...args: unknown[]) => mockPost(...args),
      },
      "watch-histories": {
        $get: (...args: unknown[]) => mockWatchHistoryGet(...args),
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// useGenerateAnalysis は生成前に連携状態を見て履歴同期を挟む。
// 連携状態はテストごとに差し替えられるよう関数経由にする。
let mockIsConnected = true;
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({ "X-Annict-Token": "annict-token" }),
  useAnnictConnection: () => ({
    isConnected: mockIsConnected,
    isLoading: false,
  }),
}));

const ANALYSIS_BODY = {
  analysis: {
    summary: "SF 系を好む傾向があります",
    recommendedGenres: ["SF"],
    generatedAt: "2026-04-25T00:00:00.000Z",
    workCount: 12,
  },
};

describe("useAnalysis / useGenerateAnalysis", () => {
  const userId = "user_test";
  const queryKey = [...ANALYSIS_QUERY_KEY, userId];
  let client: QueryClient;

  function createWrapper(c: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
    };
  }

  // useWatchHistory.test.tsx と同じ理由で、Mutation の GC タイマーを
  // 確実に止めてから Jest を抜ける。
  beforeEach(async () => {
    resetAuth();
    jest.clearAllMocks();
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    mockIsConnected = true;
    mockWatchHistoryGet.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });

  it("useAnalysis: 保存済みの分析結果を返す", async () => {
    mockGet.mockResolvedValue({ ok: true, json: async () => ANALYSIS_BODY });

    const { result } = await renderHook(() => useAnalysis(), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ANALYSIS_BODY);
    // 認証ヘッダの組み立ては apiFetch に委譲されたため、呼び出し側は
    // fetch オプションを渡すだけになる。
    expect(mockGet).toHaveBeenCalledWith({}, { fetch: expect.any(Function) });
  });

  it("useAnalysis: 未サインインではクエリを実行しない", async () => {
    signedOutUser();

    const { result } = await renderHook(() => useAnalysis(), {
      wrapper: createWrapper(client),
    });
    // enabled=false のまま pending（fetch されない）。
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("useAnalysis: API エラーは ApiRequestError になる", async () => {
    // 実際のエラー変換は apiFetch 側で行われるため、apiClient の
    // モックは変換後の ApiRequestError を reject する。
    mockGet.mockRejectedValue(
      new ApiRequestError(500, "分析結果の取得に失敗しました"),
    );

    const { result } = await renderHook(() => useAnalysis(), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect((result.current.error as ApiRequestError).status).toBe(500);
  });

  it("useGenerateAnalysis: 成功したら分析クエリを無効化する", async () => {
    client.setQueryData(queryKey, { analysis: null });
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...ANALYSIS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("useGenerateAnalysis: 429 はサーバーのエラーメッセージを ApiRequestError に載せる", async () => {
    // {error} の文言を拾う変換は apiFetch の onHttpError 側で行われる。
    mockPost.mockRejectedValue(
      new ApiRequestError(
        429,
        "視聴傾向分析の実行回数が上限に達しました。しばらくしてから再度お試しください",
      ),
    );

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect((result.current.error as ApiRequestError).status).toBe(429);
    expect((result.current.error as ApiRequestError).message).toContain(
      "実行回数が上限",
    );
  });

  it("useGenerateAnalysis: onHttpError は応答 body の error 文言を使う", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...ANALYSIS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 生成 POST 用の apiFetch オプションから本番の onHttpError を取り出して
    // 文言変換そのものを検証する（モックした mockPost では通らない経路）。
    const genOptions = mockApiFetch.mock.calls
      .map(
        (call) =>
          call[0] as { onHttpError?: (res: Response) => Promise<Error> },
      )
      .find((opts) => typeof opts.onHttpError === "function");
    expect(genOptions).toBeDefined();
    const error = await genOptions!.onHttpError!(
      new Response(
        JSON.stringify({
          error:
            "視聴傾向分析の実行回数が上限に達しました。しばらくしてから再度お試しください",
        }),
        { status: 429 },
      ),
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(429);
    expect(error.message).toContain("実行回数が上限");
  });

  it("useGenerateAnalysis: 連携済みなら履歴を同期してから生成する", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...ANALYSIS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // 同期 GET が POST より先に呼ばれる（POST は D1 スナップショットを
    // 見るため、read-through で先に最新化する必要がある）。
    expect(mockWatchHistoryGet).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockWatchHistoryGet.mock.invocationCallOrder[0]!).toBeLessThan(
      mockPost.mock.invocationCallOrder[0]!,
    );
    // 同期 GET には apiFetch（Clerk JWT + Annict トークン付与）が渡される。
    // ヘッダの中身は apiFetch 側の責務（lib/api.test.ts で検証）。
    expect(mockWatchHistoryGet).toHaveBeenCalledWith(
      {},
      { fetch: expect.any(Function) },
    );
    // 生成 POST 自体は Annict ヘッダを付けない（annict オプトインなし）。
    const genOptions = mockApiFetch.mock.calls
      .map((call) => call[0] as { annict?: boolean })
      .find((opts) => !("errorMessage" in opts));
    expect(genOptions?.annict).toBeUndefined();
  });

  it("useGenerateAnalysis: 未連携なら同期せずそのまま生成する", async () => {
    mockIsConnected = false;
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...ANALYSIS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockWatchHistoryGet).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("useGenerateAnalysis: 履歴同期に失敗したら生成せずエラーになる", async () => {
    mockWatchHistoryGet.mockRejectedValue(
      new ApiRequestError(
        502,
        "視聴履歴の同期に失敗しました。時間をおいて再度お試しください",
      ),
    );

    const { result } = await renderHook(() => useGenerateAnalysis(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect((result.current.error as ApiRequestError).status).toBe(502);
    expect((result.current.error as ApiRequestError).message).toContain(
      "視聴履歴の同期",
    );
    // 古い履歴での生成を避けるため POST には進まない。
    expect(mockPost).not.toHaveBeenCalled();
  });
});
