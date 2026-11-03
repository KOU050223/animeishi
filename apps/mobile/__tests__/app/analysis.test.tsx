import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import AnalysisScreen from "@/app/analysis";
import { ApiRequestError } from "@/lib/apiError";

// おすすめカードの詳細導線（issue #347）を検証する画面テスト。
// 分析・おすすめの生成ロジックは各フックのテストに任せ、ここでは
// 「カードから作品詳細シートが開く」「シート経由の Tier 表遷移」だけを見る。
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseRecommendations = jest.fn();
const mockMutateHistory = jest.fn();
const mockToggleFavorite = jest.fn();
const mockTrackEvent = jest.fn();
const mockAlert = jest.fn();
const mockUseAnnictConnection = jest.fn();
const mockUseAnnictConnect = jest.fn();
const mockFunnelTrack = jest.fn();
const mockUseAnnictTokenErrorPrompt = jest.fn();
const mockPromptAnnictTokenError = jest.fn();

jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画する。画面が headerLeft / title として
  // 渡したもの（戻るボタンの testID・画面タイトル）をテストできるようにする。
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
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
        sections: [
          {
            key: "genres",
            title: "よく見るジャンル",
            insight: "アクション中心の傾向です",
            facts: [
              { label: "集計対象", value: "ジャンル情報のある 10 / 11 件" },
              { label: "Action", value: "6 件（60%）" },
            ],
            evidenceWorks: [
              { annictWorkId: 7, title: "根拠アニメ", state: "WATCHED" },
              { annictWorkId: 8, title: "断念アニメ", state: "STOP_WATCHING" },
            ],
          },
        ],
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
  useDeleteWatchHistory: () => ({
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

// 詳細シートの評価フックも実物だと QueryClient が要るためスタブにする
// （評価セクション自体は AnimeWorkDetailSheet.test.tsx で検証）。
// 未評価を返すので視聴済み以外ではセクションは出ない。
jest.mock("@/lib/useWorkRating", () => ({
  useWorkRating: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpsertWorkRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteWorkRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
  WORK_RATING_LABELS: { bad: "イマイチ", good: "良い", great: "最高" },
}));

// 詳細シート内の話数一覧・記録フックも実物だと QueryClient が要るため
// スタブにする（話数セクション自体は AnimeWorkDetailSheet.test.tsx で検証）。
jest.mock("@/lib/useWorkEpisodes", () => ({
  useWorkEpisodes: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useRecordEpisode: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUnrecordEpisode: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
  alert: (...args: unknown[]) => mockAlert(...args),
  confirm: jest.fn(),
}));

// 分析画面と詳細シートが使う Annict 連携系フックを差し替える。
// 既定は連携済みで、失敗は「Annict トークン起因でない」とする。
jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => mockUseAnnictConnection(),
  useAnnictConnect: () => mockUseAnnictConnect(),
  useAnnictFunnel: () => mockFunnelTrack,
  useAnnictTokenErrorPrompt: (...args: unknown[]) =>
    mockUseAnnictTokenErrorPrompt(...args),
  annictErrorKey: jest.requireActual("@/lib/annict/errorMessages")
    .annictErrorKey,
}));

// 作品詳細シートは work が null でもマウントされてフックが走るため、
// 両方の describe で連携済みの既定値を用意する。
const stubAnnictDefaults = () => {
  mockUseAnnictConnection.mockReturnValue({
    isConnected: true,
    isLoading: false,
  });
  mockUseAnnictConnect.mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnecting: false,
  });
  mockUseAnnictTokenErrorPrompt.mockReturnValue(mockPromptAnnictTokenError);
  mockPromptAnnictTokenError.mockReturnValue(false);
};

describe("AnalysisScreen のレポート項目", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    stubAnnictDefaults();
    mockUseRecommendations.mockReturnValue({
      data: { recommendations: null },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it("セクションの項目名・解釈文・集計値・根拠作品を表示する", async () => {
    await render(<AnalysisScreen />);

    expect(screen.getByText("よく見るジャンル")).toBeTruthy();
    expect(screen.getByText("アクション中心の傾向です")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
    expect(screen.getByText("6 件（60%）")).toBeTruthy();
    // 根拠作品はタイトルと視聴ステータスのラベル付きで出る。
    expect(screen.getByText("・根拠アニメ（視聴済）")).toBeTruthy();
    expect(screen.getByText("・断念アニメ（断念）")).toBeTruthy();
  });
});

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
    stubAnnictDefaults();
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

  it("「見たい」登録が annict_token_required で失敗したとき再連携プロンプトに委譲し汎用アラートを出さない", async () => {
    const tokenError = new ApiRequestError(
      401,
      "視聴履歴の更新に失敗しました",
      "annict_token_required",
    );
    mockPromptAnnictTokenError.mockReturnValue(true);

    await render(<AnalysisScreen />);
    await fireEvent.press(screen.getByTestId("recommendation-wanna-watch-42"));

    const [, options] = mockMutateHistory.mock.calls[0];
    options.onError(tokenError);

    expect(mockUseAnnictTokenErrorPrompt).toHaveBeenCalledWith("analysis");
    expect(mockPromptAnnictTokenError).toHaveBeenCalledWith(tokenError);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("「見たい」登録がトークン起因でない失敗は従来どおり汎用アラートを出す", async () => {
    const otherError = new ApiRequestError(500, "視聴履歴の更新に失敗しました");

    await render(<AnalysisScreen />);
    await fireEvent.press(screen.getByTestId("recommendation-wanna-watch-42"));

    const [, options] = mockMutateHistory.mock.calls[0];
    options.onError(otherError);

    expect(mockPromptAnnictTokenError).toHaveBeenCalledWith(otherError);
    expect(mockAlert).toHaveBeenCalledWith(
      "「見たい」の登録に失敗しました",
      "視聴履歴の更新に失敗しました",
      { okLabel: "OK" },
    );
  });
});
