import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import AnalysisScreen from "@/app/analysis";

// おすすめカードの詳細導線（issue #347）を検証する画面テスト。
// 分析・おすすめの生成ロジックは各フックのテストに任せ、ここでは
// 「カードから作品詳細シートが開く」「シート経由の Tier 表遷移」だけを見る。
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseRecommendations = jest.fn();
const mockMutateHistory = jest.fn();
const mockToggleFavorite = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: mockBack,
    push: mockPush,
    replace: jest.fn(),
  }),
}));

jest.mock("@/lib/useAnalysis", () => ({
  useAnalysis: () => ({
    data: {
      analysis: {
        summary: "アクションものをよく見ています",
        recommendedGenres: ["アクション"],
        workCount: 12,
        generatedAt: "2026-01-01T00:00:00Z",
      },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useGenerateAnalysis: () => ({ mutate: jest.fn(), isPending: false }),
}));

const RECOMMENDED_WORK = {
  annictWorkId: 42,
  title: "おすすめアニメ",
  titleKana: null,
  titleEn: "Recommended Anime",
  seasonName: "2026-spring",
  seasonYear: 2026,
  hostedImageUrl: null,
  reason: "好みに合いそう",
};

jest.mock("@/lib/useRecommendations", () => ({
  useRecommendations: () => mockUseRecommendations(),
  useGenerateRecommendations: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock("@/lib/useWatchHistory", () => ({
  useUpsertWatchHistory: () => ({
    mutate: mockMutateHistory,
    mutateAsync: jest.fn(() => Promise.resolve({})),
    isPending: false,
  }),
  useWatchHistory: () => ({ data: [] }),
  WATCH_STATUS_LABELS: {
    WATCHING: "視聴中",
    WATCHED: "視聴済",
    ON_HOLD: "一時停止",
    STOP_WATCHING: "断念",
    WANNA_WATCH: "視聴予定",
  },
}));

jest.mock("@/lib/useFavorites", () => ({
  useFavoriteIds: () => new Set<number>(),
  useToggleFavorite: () => ({
    toggle: mockToggleFavorite,
    isPending: false,
  }),
}));

jest.mock("@/lib/useWorkDetail", () => ({
  useWorkDetail: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  WORK_DETAIL_QUERY_KEY: ["works", "detail"],
  workDetailQueryKey: (userId: string, annictWorkId: number) => [
    "works",
    "detail",
    userId,
    annictWorkId,
  ],
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock("@/lib/events", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock("@/lib/dialog", () => ({
  alert: jest.fn(),
}));

describe("AnalysisScreen のおすすめカード", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockUseRecommendations.mockReturnValue({
      data: {
        recommendations: {
          works: [RECOMMENDED_WORK],
          generatedAt: "2026-01-01T00:00:00Z",
        },
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it("おすすめ作品のタイトル・理由・シーズンを表示する", async () => {
    await render(<AnalysisScreen />);

    expect(screen.getByText("おすすめアニメ")).toBeTruthy();
    expect(screen.getByText("好みに合いそう")).toBeTruthy();
    expect(screen.getByText("2026年春")).toBeTruthy();
  });

  it("「詳細」を押すと作品詳細シートが開く", async () => {
    await render(<AnalysisScreen />);

    await fireEvent.press(screen.getByTestId("recommendation-detail-42"));

    expect(screen.getByTestId("anime-work-detail-sheet")).toBeTruthy();
    // シート内では英語タイトルも見える
    expect(screen.getByText("Recommended Anime")).toBeTruthy();
  });

  it("シートの「キャラ Tier 表を作る」から対象作品を渡して遷移する", async () => {
    await render(<AnalysisScreen />);

    await fireEvent.press(screen.getByTestId("recommendation-detail-42"));
    await fireEvent.press(
      screen.getByTestId("work-detail-character-tier-list"),
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "42", workTitle: "おすすめアニメ" },
    });
    expect(screen.queryByTestId("anime-work-detail-sheet")).toBeNull();
  });

  it("「見たい」を押すと WANNA_WATCH で視聴履歴を登録する", async () => {
    await render(<AnalysisScreen />);

    await fireEvent.press(screen.getByTestId("recommendation-wanna-watch-42"));

    expect(mockMutateHistory).toHaveBeenCalledWith(
      { annictWorkId: 42, data: { state: "WANNA_WATCH" } },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
