import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ACHIEVEMENTS_QUERY_KEY,
  achievementsQueryKey,
  currentAchievementSeason,
  useAchievements,
} from "@/lib/achievements/useAchievements";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../../__mocks__/@clerk/expo";

const mockGet = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      achievements: {
        $get: (...args: unknown[]) => mockGet(...args),
      },
    },
  },
}));

// useAchievements の import 元（barrel）。Annict 認証ヘッダは空でよい
// （apiClient 側はモック済み）。
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({}),
}));

describe("currentAchievementSeason", () => {
  it("JST 基準の <year>-<season> を返し、API の今期判定と揃う", () => {
    // 2026-03-31 16:00 UTC = 4/1 01:00 JST。UTC ではまだ winter だが
    // JST では spring に切り替わっている（API の currentAnnictSeason と同じ）。
    expect(currentAchievementSeason(new Date("2026-03-31T16:00:00Z"))).toBe(
      "2026-spring",
    );
    expect(currentAchievementSeason(new Date("2026-03-31T14:59:00Z"))).toBe(
      "2026-winter",
    );
  });
});

describe("achievementsQueryKey", () => {
  it("ユーザー ID とシーズンを含み、prefix 無効化が効く形になる", () => {
    const key = achievementsQueryKey("u1", "2026-winter");
    expect(key).toEqual(["achievements", "u1", "2026-winter"]);
    // 無効化は ACHIEVEMENTS_QUERY_KEY の prefix マッチで行うため先頭が共通
    expect(key.slice(0, ACHIEVEMENTS_QUERY_KEY.length)).toEqual([
      ...ACHIEVEMENTS_QUERY_KEY,
    ]);
  });
});

describe("useAchievements", () => {
  const userId = "user_ach";

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
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    mockGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        achievements: [],
        season: currentAchievementSeason(),
        stats: {
          watchedCount: 0,
          currentStreakWeeks: 0,
          bestStreakWeeks: 0,
        },
      }),
    });
    client = new QueryClient();
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
    client.clear();
  });

  it("クエリキーに現在シーズンを含めて取得する", async () => {
    const { result } = await renderHook(() => useAchievements(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual([
      ["achievements", userId, currentAchievementSeason()],
    ]);
  });
});
