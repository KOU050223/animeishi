import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useDeleteWorkRating,
  useUpsertWorkRating,
  useWorkRating,
  WORK_RATING_QUERY_KEY,
} from "@/lib/useWorkRating";
import type { WorkRating } from "@/lib/useWorkRating";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      "work-ratings": {
        ":annictWorkId": {
          $get: (...args: unknown[]) => mockGet(...args),
          $put: (...args: unknown[]) => mockPut(...args),
          $delete: (...args: unknown[]) => mockDelete(...args),
        },
      },
    },
  },
}));

// 評価は Animeishi の D1 が正で Annict 連携を必須としない。
// Annict ヘッダは初期値候補・未キャッシュ作品の解決用で、ここでは空でよい。
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({}),
}));

const USER_ID = "user_test";
const ANNICT_WORK_ID = 42;
const queryKey = [...WORK_RATING_QUERY_KEY, USER_ID, ANNICT_WORK_ID];

type RatingResponse = {
  rating: WorkRating | null;
  annictRating: WorkRating | null;
};

const seedRating = (
  overrides: Partial<RatingResponse> = {},
): RatingResponse => ({
  rating: "great",
  annictRating: null,
  ...overrides,
});

const getStoredRating = (client: QueryClient) =>
  client.getQueryData<RatingResponse>(queryKey)?.rating;

function createWrapper(client: QueryClient) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
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

describe("useWorkRating", () => {
  it("GET /me/work-ratings/:annictWorkId を呼んで評価を返す", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      json: async () => seedRating(),
    });

    const { result } = await renderHook(() => useWorkRating(ANNICT_WORK_ID), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(
      { param: { annictWorkId: String(ANNICT_WORK_ID) } },
      expect.anything(),
    );
    expect(result.current.data?.rating).toBe("great");
  });

  it("評価が無い作品は rating / annictRating とも null を返し得る", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      json: async () => seedRating({ rating: null }),
    });

    const { result } = await renderHook(() => useWorkRating(ANNICT_WORK_ID), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rating).toBeNull();
    expect(result.current.data?.annictRating).toBeNull();
  });
});

describe("useUpsertWorkRating / useDeleteWorkRating の楽観的更新", () => {
  it("保存は API 応答を待たず選択を先に反映する", async () => {
    client.setQueryData(queryKey, seedRating({ rating: null }));
    let resolvePut: (v: unknown) => void = () => {};
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        }),
    );

    const { result } = await renderHook(
      () => useUpsertWorkRating(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate({ rating: "great" });
    });

    await waitFor(() => expect(getStoredRating(client)).toBe("great"));

    await act(async () => {
      resolvePut({
        ok: true,
        json: async () => ({ annictWorkId: ANNICT_WORK_ID, rating: "great" }),
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("保存が失敗したら選択を元に戻し rolledBack を立てる", async () => {
    client.setQueryData(queryKey, seedRating({ rating: "good" }));
    mockPut.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(
      () => useUpsertWorkRating(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate({ rating: "bad" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStoredRating(client)).toBe("good");
    const error = result.current.error as { rolledBack?: boolean } | null;
    expect(error?.rolledBack).toBe(true);
  });

  it("解除は API 応答を待たず選択を先に外す", async () => {
    client.setQueryData(queryKey, seedRating());
    let resolveDelete: (v: unknown) => void = () => {};
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const { result } = await renderHook(
      () => useDeleteWorkRating(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(getStoredRating(client)).toBeNull());

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

  it("解除が失敗したら選択を元に戻す", async () => {
    client.setQueryData(queryKey, seedRating());
    mockDelete.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(
      () => useDeleteWorkRating(ANNICT_WORK_ID),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStoredRating(client)).toBe("great");
  });

  it("保存と解除は同じスコープで直列化される", async () => {
    client.setQueryData(queryKey, seedRating());
    const resolvers: Array<(v: unknown) => void> = [];
    const calls: string[] = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls.push("put");
          resolvers.push(resolve);
        }),
    );
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls.push("delete");
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(
      () => ({
        upsert: useUpsertWorkRating(ANNICT_WORK_ID),
        remove: useDeleteWorkRating(ANNICT_WORK_ID),
      }),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.remove.mutate();
      result.current.upsert.mutate({ rating: "bad" });
    });

    // DELETE が settle するまで PUT は始まらない。
    await waitFor(() => expect(calls).toEqual(["delete"]));
    await act(async () => {
      resolvers[0]({
        ok: true,
        headers: { get: () => null },
        json: async () => ({}),
      });
    });
    await waitFor(() => expect(calls).toEqual(["delete", "put"]));
  });
});
