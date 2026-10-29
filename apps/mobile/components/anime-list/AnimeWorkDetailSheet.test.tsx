import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiRequestError } from "@/lib/apiError";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";

// 詳細取得（API / Annict 連携）とステータス更新はフックのテストで検証する。
// シート側は「描画と操作の受け渡し」だけを見るため、フックは状態ごとに
// 差し替えられるモックにする。
const mockUseWorkDetail = jest.fn();
const mockMutateAsync = jest.fn();
const mockTrackEvent = jest.fn();
const mockAlert = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock("@/lib/useWorkDetail", () => ({
  useWorkDetail: (...args: unknown[]) => mockUseWorkDetail(...args),
  workDetailQueryKey: (annictWorkId: number) => [
    "works",
    "detail",
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
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock("@/lib/events", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

const WORK = {
  annictWorkId: 42,
  nodeId: "n42",
  state: null,
  title: "テストアニメ",
  titleKana: null,
  titleEn: "Test Anime",
  seasonName: "2026-spring",
  seasonYear: 2026,
  imageUrl: null,
  resolvedImageUrl: null,
  hostedImageUrl: "https://api.example/images/works/42",
  malAnimeId: 1234,
};

const DETAIL = {
  work: {
    ...WORK,
    state: "WATCHING",
    titleRo: null,
    media: "TV",
    episodesCount: 12,
    noEpisodes: false,
    watchersCount: 5432,
    reviewsCount: 3,
    satisfactionRate: 87.5,
    officialSiteUrl: "https://example.com/official",
    officialSiteUrlEn: null,
    wikipediaUrl: "https://ja.wikipedia.org/wiki/example",
    wikipediaUrlEn: null,
    twitterUsername: "test_anime",
    twitterHashtag: null,
  },
};

const detailState = (overrides: Record<string, unknown> = {}) => ({
  data: DETAIL,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  ...overrides,
});

const sheetElement = (
  props: {
    work?: typeof WORK | null;
    isFavorite?: boolean;
    onToggleFavorite?: jest.Mock;
    onOpenCharacterTierList?: jest.Mock;
    onClose?: jest.Mock;
  } = {},
) => (
  <AnimeWorkDetailSheet
    work={props.work === undefined ? WORK : props.work}
    onClose={props.onClose ?? jest.fn()}
    isFavorite={props.isFavorite ?? false}
    onToggleFavorite={props.onToggleFavorite ?? jest.fn()}
    isTogglingFavorite={false}
    onOpenCharacterTierList={props.onOpenCharacterTierList ?? jest.fn()}
  />
);

describe("AnimeWorkDetailSheet", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockUseWorkDetail.mockReturnValue(detailState());
    mockMutateAsync.mockResolvedValue({});
  });

  it("work が null のときシートを表示しない", async () => {
    await render(sheetElement({ work: null }));

    expect(screen.queryByTestId("anime-work-detail-sheet")).toBeNull();
  });

  it("作品の画像・タイトル（日英）・シーズン・メディア種別を表示する", async () => {
    await render(sheetElement());

    expect(screen.getByText("テストアニメ")).toBeTruthy();
    expect(screen.getByText("Test Anime")).toBeTruthy();
    expect(screen.getByText(/2026年春・TV/)).toBeTruthy();
    expect(screen.getByLabelText("テストアニメのサムネイル")).toBeTruthy();
  });

  it("Annict の詳細情報（話数・視聴者数・満足度・リンク）を表示する", async () => {
    await render(sheetElement());

    expect(screen.getByText("全12話")).toBeTruthy();
    expect(screen.getByText("5,432人")).toBeTruthy();
    expect(screen.getByText("88%")).toBeTruthy();
    expect(screen.getByText("公式サイト")).toBeTruthy();
    expect(screen.getByText("Wikipedia")).toBeTruthy();
    expect(screen.getByText("X @test_anime")).toBeTruthy();
  });

  it("詳細取得中は基本情報だけを表示し詳細セクションを出さない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: undefined, isLoading: true }),
    );

    await render(sheetElement());

    expect(screen.getByText("テストアニメ")).toBeTruthy();
    expect(screen.queryByText("全12話")).toBeNull();
  });

  it("詳細取得に失敗したら再試行ボタンを出す", async () => {
    const refetch = jest.fn();
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: undefined, isError: true, refetch }),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("詳細の視聴ステータスが選択済みのチップとして表示される", async () => {
    await render(sheetElement());

    const chip = screen.getByTestId("work-detail-status-WATCHING");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("視聴ステータスのチップを押すと upsert が呼ばれ選択状態になる", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "watch_status_change",
      expect.objectContaining({ from: "WATCHING", to: "WATCHED" }),
    );
    expect(mockMutateAsync).toHaveBeenCalledWith({
      annictWorkId: 42,
      data: { state: "WATCHED" },
    });
    const chip = screen.getByTestId("work-detail-status-WATCHED");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("現在のステータスと同じチップを押しても upsert を呼ばない", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("ステータス更新に失敗したらダイアログで通知し選択を元に戻す", async () => {
    mockMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "視聴履歴の更新に失敗しました"),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));

    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    // 楽観値は下ろされ、サーバー値（WATCHING）の表示に戻る
    const chip = screen.getByTestId("work-detail-status-WATCHING");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("推し登録ボタンを押すと onToggleFavorite が呼ばれる", async () => {
    const onToggleFavorite = jest.fn();
    await render(sheetElement({ onToggleFavorite }));

    await fireEvent.press(screen.getByTestId("work-detail-favorite"));

    expect(onToggleFavorite).toHaveBeenCalled();
  });

  it("「キャラ Tier 表を作る」を押すと対象作品が onOpenCharacterTierList に渡る", async () => {
    const onOpenCharacterTierList = jest.fn();
    await render(sheetElement({ onOpenCharacterTierList }));

    await fireEvent.press(
      screen.getByTestId("work-detail-character-tier-list"),
    );

    expect(onOpenCharacterTierList).toHaveBeenCalledWith(WORK);
  });
});
