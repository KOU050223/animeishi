import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import type { QueryClient } from "@tanstack/react-query";
import {
  RECOMMENDATIONS_QUERY_KEY,
  useGenerateRecommendations,
  useRecommendations,
} from "@/lib/useRecommendations";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";
import { setMockClerkState } from "@/__mocks__/@clerk/expo";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockWatchHistoryGet = jest.fn();
const mockApiFetch = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      analysis: {
        recommendations: {
          $get: (...args: unknown[]) => mockGet(...args),
          $post: (...args: unknown[]) => mockPost(...args),
        },
      },
      "watch-histories": {
        $get: (...args: unknown[]) => mockWatchHistoryGet(...args),
      },
    },
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// 生成前に連携状態を見て履歴同期を挟む。連携状態はテストごとに差し替える。
let mockIsConnected = true;
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({ "X-Annict-Token": "annict-token" }),
  useAnnictConnection: () => ({
    isConnected: mockIsConnected,
    isLoading: false,
  }),
}));

const RECOMMENDATIONS_BODY = {
  recommendations: {
    works: [
      {
        annictWorkId: 9001,
        title: "おすすめ作品9001",
        titleKana: null,
        titleEn: null,
        seasonName: "2026-spring",
        seasonYear: 2026,
        hostedImageUrl: "https://api.example.com/images/works/9001",
        reason: "SF 好きに合いそう",
      },
    ],
    generatedAt: "2026-10-30T00:00:00.000Z",
  },
};

describe("useRecommendations / useGenerateRecommendations", () => {
  const userId = "user_test";
  const queryKey = [...RECOMMENDATIONS_QUERY_KEY, userId];
  let client: QueryClient;

  function createWrapper(c: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
    };
  }

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
    client = createTestQueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it("useRecommendations: 保存済みのおすすめを返す（Annict トークンは不要）", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      json: async () => RECOMMENDATIONS_BODY,
    });

    const { result } = await renderHook(() => useRecommendations(), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDATIONS_BODY);
    // 保存済みの再表示は AI も Annict も呼ばない。認証ヘッダの組み立ては
    // apiFetch に委譲されたため、呼び出し側は fetch オプションを渡すだけ。
    expect(mockGet).toHaveBeenCalledWith({}, { fetch: expect.any(Function) });
  });

  it("useRecommendations: 未サインインではクエリを実行しない", async () => {
    signedOutUser();

    const { result } = await renderHook(() => useRecommendations(), {
      wrapper: createWrapper(client),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("useGenerateRecommendations: 連携済みなら履歴を同期してから Annict トークン付きで生成する", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...RECOMMENDATIONS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateRecommendations(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // 同期 GET が POST より先に呼ばれる（POST は D1 スナップショットを見る）。
    expect(mockWatchHistoryGet).toHaveBeenCalledTimes(1);
    expect(mockWatchHistoryGet.mock.invocationCallOrder[0]!).toBeLessThan(
      mockPost.mock.invocationCallOrder[0]!,
    );
    // POST には Annict トークンが要る（searchWorks で照合するため）。
    // ヘッダの組み立ては apiFetch に委譲（ヘッダ内容は lib/api.test.ts で検証）。
    expect(mockPost).toHaveBeenCalledWith(undefined, {
      fetch: expect.any(Function),
    });
    // 生成 POST は annict オプトインが必須。オプションそのものを検証する。
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.objectContaining({ annict: true }),
    );
  });

  it("useGenerateRecommendations: 未連携なら同期せずそのまま生成を試みる", async () => {
    mockIsConnected = false;
    // 実際のエラー変換は apiFetch 側で行われるため、apiClient の
    // モックは変換後の ApiRequestError を reject する。
    mockPost.mockRejectedValue(
      new ApiRequestError(
        401,
        "Annict 連携が必要です",
        "annict_token_required",
      ),
    );

    const { result } = await renderHook(() => useGenerateRecommendations(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockWatchHistoryGet).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect((result.current.error as ApiRequestError).message).toContain(
      "Annict 連携",
    );
  });

  it("useGenerateRecommendations: 429 はサーバーのエラーメッセージを ApiRequestError に載せる", async () => {
    // {error} の文言を拾う変換は apiFetch の onHttpError 側で行われる。
    mockPost.mockRejectedValue(
      new ApiRequestError(
        429,
        "おすすめ生成の実行回数が上限に達しました。しばらくしてから再度お試しください",
      ),
    );

    const { result } = await renderHook(() => useGenerateRecommendations(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiRequestError).status).toBe(429);
    expect((result.current.error as ApiRequestError).message).toContain(
      "実行回数が上限",
    );
  });

  it("useGenerateRecommendations: onHttpError は code から表示文言を引く", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...RECOMMENDATIONS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateRecommendations(), {
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
          error: "Generation rate limit reached",
          code: "generation_limit",
        }),
        { status: 429 },
      ),
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(429);
    expect(error.message).toBe(
      "試行回数が上限に達しました。しばらくしてからお試しください",
    );
  });

  it("useGenerateRecommendations: 成功したらおすすめクエリを無効化する", async () => {
    client.setQueryData(queryKey, { recommendations: null });
    mockPost.mockResolvedValue({
      ok: true,
      json: async () => ({ ...RECOMMENDATIONS_BODY, cached: false }),
    });

    const { result } = await renderHook(() => useGenerateRecommendations(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("useGenerateRecommendations: 履歴同期に失敗したら生成せずエラーになる", async () => {
    mockWatchHistoryGet.mockRejectedValue(
      new ApiRequestError(
        502,
        "視聴履歴の同期に失敗しました。時間をおいて再度お試しください",
      ),
    );

    const { result } = await renderHook(() => useGenerateRecommendations(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiRequestError).status).toBe(502);
    // 古い履歴での生成を避けるため POST には進まない。
    expect(mockPost).not.toHaveBeenCalled();
  });
});
