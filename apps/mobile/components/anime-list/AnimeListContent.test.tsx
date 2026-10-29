import { fireEvent, render, screen } from "@testing-library/react-native";
import { AnimeListContent } from "./AnimeListContent";

// 一覧のデータ取得（Annict プロキシ検索・接続状態）は useAnimeList の
// テストで検証する。ここでは「カードの描画・押下で詳細シートが開く」
// 配線だけを見るため、フックは固定値のモックにする。
const mockPush = jest.fn();
const mockMutateAsync = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/lib/useAnimeList", () => ({
  useAnimeList: () => ({
    data: [WORK],
    isLoading: false,
    isError: false,
    isFetching: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
    isConnected: true,
    isConnectionLoading: false,
    isSeason: true,
  }),
  usePrefetchSeasonWorks: jest.fn(),
  useSortedAnimeList: (data: unknown) => data ?? [],
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

jest.mock("@/lib/useWatchHistory", () => ({
  useUpsertWatchHistory: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  WATCH_STATUS_LABELS: {
    WATCHING: "視聴中",
    WATCHED: "視聴済",
    ON_HOLD: "一時停止",
    STOP_WATCHING: "断念",
    WANNA_WATCH: "視聴予定",
  },
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock("@/lib/events", () => ({
  trackEvent: jest.fn(),
}));

const WORK = {
  annictWorkId: 42,
  nodeId: "n42",
  state: null,
  title: "テストアニメ",
  titleKana: null,
  // 英語タイトルは検索の一致対象として残るが、カードには表示しない（issue #347）
  titleEn: "Hidden English Title",
  seasonName: "2026-spring",
  seasonYear: 2026,
  imageUrl: null,
  resolvedImageUrl: null,
  hostedImageUrl: "https://api.example/images/works/42",
  malAnimeId: null,
};

const contentElement = (
  props: {
    favoriteIds?: Set<number>;
    toggleFavorite?: jest.Mock;
  } = {},
) => (
  <AnimeListContent
    favoriteIds={props.favoriteIds ?? new Set()}
    toggleFavorite={props.toggleFavorite ?? jest.fn()}
    isToggling={false}
  />
);

describe("AnimeListContent", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
  });

  it("カードには日本語タイトルとシーズンだけを出し、英語タイトルは出さない", async () => {
    await render(contentElement());

    expect(screen.getByText("テストアニメ")).toBeTruthy();
    expect(screen.getByText("2026年春")).toBeTruthy();
    expect(screen.queryByText("Hidden English Title")).toBeNull();
  });

  it("カードを押すと作品詳細シートが開き、英語タイトルはシート内で見える", async () => {
    await render(contentElement());

    await fireEvent.press(screen.getByTestId("anime-item-42"));

    expect(screen.getByTestId("anime-work-detail-sheet")).toBeTruthy();
    expect(screen.getByText("Hidden English Title")).toBeTruthy();
  });

  it("詳細シートの「キャラ Tier 表を作る」から対象作品を渡して遷移する", async () => {
    await render(contentElement());

    await fireEvent.press(screen.getByTestId("anime-item-42"));
    await fireEvent.press(
      screen.getByTestId("work-detail-character-tier-list"),
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/character-tier-list",
      params: { workId: "42", workTitle: "テストアニメ" },
    });
    // Tier 表から戻ったとき一覧の上にシートが残らないよう、遷移前に閉じる。
    expect(screen.queryByTestId("anime-work-detail-sheet")).toBeNull();
  });
});
