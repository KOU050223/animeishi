import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WORK_EPISODES_QUERY_KEY,
  useRecordEpisode,
  useUnrecordEpisode,
  useWorkEpisodes,
} from "@/lib/useWorkEpisodes";
import { PROFILE_QUERY_KEY } from "@/lib/useProfile";
import { publicProfileQueryKey } from "@/lib/publicProfile";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      "episode-records": {
        ":annictEpisodeId": {
          $put: (...args: unknown[]) => mockPut(...args),
          $delete: (...args: unknown[]) => mockDelete(...args),
        },
      },
    },
    works: {
      ":annictWorkId": {
        episodes: {
          $get: (...args: unknown[]) => mockGet(...args),
        },
      },
    },
  },
}));

// Annict 認証ヘッダは空でよい（apiClient 側はモック済み）。連携状態は
// 既定で連携済みにして、クエリが発行される状態にする。
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({}),
  useAnnictConnection: () => ({ isConnected: true, isLoading: false }),
}));

const USER_ID = "user_test";
const ANNICT_WORK_ID = 42;
const queryKey = [...WORK_EPISODES_QUERY_KEY, USER_ID, ANNICT_WORK_ID];

const seedEpisodes = () => ({
  episodes: [
    {
      annictEpisodeId: 101,
      number: 1,
      numberText: "第1話",
      sortNumber: 1,
      title: null,
      watched: false,
      recordsCount: 0,
      lastRecordedAt: null,
    },
    {
      annictEpisodeId: 102,
      number: 2,
      numberText: "第2話",
      sortNumber: 2,
      title: null,
      watched: true,
      recordsCount: 1,
      lastRecordedAt: "2026-10-01T10:00:00.000Z",
    },
  ],
});

function createWrapper(client: QueryClient) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function getWatched(client: QueryClient, annictEpisodeId: number) {
  return client
    .getQueryData<ReturnType<typeof seedEpisodes>>(queryKey)
    ?.episodes.find((e) => e.annictEpisodeId === annictEpisodeId)?.watched;
}

let client: QueryClient;
beforeEach(async () => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser({ userId: USER_ID });
  setMockClerkState({ getToken: async () => "test-token" });
  client = new QueryClient();
});

afterEach(async () => {
  await cleanup();
  client
    .getMutationCache()
    .getAll()
    .forEach((m) => m.destroy());
  client.clear();
});

describe("useWorkEpisodes", () => {
  it("GET /works/:annictWorkId/episodes を呼んで話数一覧を返す", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      json: async () => seedEpisodes(),
    });

    const { result } = await renderHook(() => useWorkEpisodes(ANNICT_WORK_ID), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(
      { param: { annictWorkId: String(ANNICT_WORK_ID) } },
      expect.anything(),
    );
    expect(result.current.data?.episodes).toHaveLength(2);
  });
});

describe("useRecordEpisode / useUnrecordEpisode の楽観的更新", () => {
  it("記録は API 応答を待たずチェックを先に付ける", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    let resolvePut: (v: unknown) => void = () => {};
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        }),
    );

    const { result } = await renderHook(
      () => useRecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(101);
    });

    await waitFor(() => expect(getWatched(client, 101)).toBe(true));
    expect(getWatched(client, 102)).toBe(true);

    await act(async () => {
      resolvePut({ ok: true, json: async () => ({ recorded: true }) });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  // issue #420: 「いま見ている」吹き出しは本人の最新記録に追従するため、
  // 記録・解除の settle 時に本人のプロフィール系クエリも無効化する。
  it("記録が settle すると本人のプロフィール系クエリも無効化する", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    const profileKey = [...PROFILE_QUERY_KEY, USER_ID];
    const publicProfileKey = publicProfileQueryKey(USER_ID);
    client.setQueryData(profileKey, {});
    client.setQueryData(publicProfileKey, {});
    mockPut.mockResolvedValue({
      ok: true,
      json: async () => ({ recorded: true }),
    });

    const { result } = await renderHook(
      () => useRecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(101);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(profileKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(publicProfileKey)?.isInvalidated).toBe(true);
  });

  it("解除が settle すると本人のプロフィール系クエリも無効化する", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    const profileKey = [...PROFILE_QUERY_KEY, USER_ID];
    const publicProfileKey = publicProfileQueryKey(USER_ID);
    client.setQueryData(profileKey, {});
    client.setQueryData(publicProfileKey, {});
    mockDelete.mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });

    const { result } = await renderHook(
      () => useUnrecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(102);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(profileKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(publicProfileKey)?.isInvalidated).toBe(true);
  });

  it("記録が失敗したらチェックを元に戻し rolledBack を立てる", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    mockPut.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(
      () => useRecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(101);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getWatched(client, 101)).toBe(false);
    const error = result.current.error as { rolledBack?: boolean } | null;
    expect(error?.rolledBack).toBe(true);
  });

  it("解除は API 応答を待たずチェックを先に外す", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    let resolveDelete: (v: unknown) => void = () => {};
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const { result } = await renderHook(
      () => useUnrecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(102);
    });

    await waitFor(() => expect(getWatched(client, 102)).toBe(false));

    await act(async () => {
      resolveDelete({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("解除が失敗したらチェックを元に戻す", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    mockDelete.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(
      () => useUnrecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(102);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getWatched(client, 102)).toBe(true);
  });

  it("記録と解除は同じスコープで直列化される", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    const resolvers: Array<(v: unknown) => void> = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(
      () => ({
        record: useRecordEpisode(ANNICT_WORK_ID),
        unrecord: useUnrecordEpisode(ANNICT_WORK_ID),
      }),
      { wrapper: createWrapper(client) },
    );

    // 記録の直後に解除しても、PUT が settle するまで DELETE は始まらない
    // （順序が入れ替わるとサーバーの最終状態と画面が食い違う）。
    await act(() => {
      result.current.record.mutate(101);
      result.current.unrecord.mutate(102);
    });
    await waitFor(() => expect(resolvers).toHaveLength(1));

    await act(async () => {
      resolvers[0]({ ok: true, json: async () => ({}) });
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });
    });
  });

  it("失敗応答の code を ApiRequestError に載せる", async () => {
    client.setQueryData(queryKey, seedEpisodes());
    mockPut.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: "Annict 連携が必要です",
        code: "annict_token_required",
      }),
    });

    const { result } = await renderHook(
      () => useRecordEpisode(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate(101);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect((result.current.error as ApiRequestError).code).toBe(
      "annict_token_required",
    );
  });
});
