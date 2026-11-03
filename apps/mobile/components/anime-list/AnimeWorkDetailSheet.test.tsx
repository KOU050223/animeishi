import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { ApiRequestError } from "@/lib/apiError";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";

// 詳細取得（API / Annict 連携）とステータス更新はフックのテストで検証する。
// シート側は「描画と操作の受け渡し」だけを見るため、フックは状態ごとに
// 差し替えられるモックにする。
const mockUseWorkDetail = jest.fn();
const mockMutateAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockTrackEvent = jest.fn();
const mockAlert = jest.fn();
const mockConfirm = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockUseAnnictConnection = jest.fn();
const mockUseAnnictConnect = jest.fn();
const mockConnect = jest.fn();
const mockFunnelTrack = jest.fn();
const mockUseAnnictTokenErrorPrompt = jest.fn();
const mockPromptAnnictTokenError = jest.fn();

jest.mock("@/lib/useWorkDetail", () => ({
  useWorkDetail: (...args: unknown[]) => mockUseWorkDetail(...args),
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
  useDeleteWatchHistory: () => ({
    mutateAsync: mockDeleteAsync,
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
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// Annict 連携系はネイティブ依存（SecureStore / expo-web-browser）を持つため
// フックを差し替える。連携状態・再連携プロンプトの分岐だけをここで制御する。
jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => mockUseAnnictConnection(),
  useAnnictConnect: () => mockUseAnnictConnect(),
  useAnnictFunnel: () => mockFunnelTrack,
  useAnnictTokenErrorPrompt: (...args: unknown[]) =>
    mockUseAnnictTokenErrorPrompt(...args),
  annictErrorKey: jest.requireActual("@/lib/annict/errorMessages")
    .annictErrorKey,
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
    mockDeleteAsync.mockResolvedValue({});
    // finally 内で invalidateQueries(...).then() を呼ぶため Promise を返す。
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockUseAnnictConnection.mockReturnValue({
      isConnected: true,
      isLoading: false,
    });
    mockUseAnnictConnect.mockReturnValue({
      connect: mockConnect,
      disconnect: jest.fn(),
      isConnecting: false,
    });
    mockUseAnnictTokenErrorPrompt.mockReturnValue(mockPromptAnnictTokenError);
    // 既定は「Annict トークン起因でない」（汎用エラー処理に落ちる）。
    mockPromptAnnictTokenError.mockReturnValue(false);
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

  it("視聴ステータスのチップを押すと upsert が呼ばれる", async () => {
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
  });

  it("更新成功後は楽観値を下ろし、再取得したサーバー値の選択に戻る", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));

    // 対象作品の詳細クエリを取り直し、サーバー値（WATCHING）の選択に戻る。
    // 楽観値を残すと開き直しで古い選択が新しい値を覆ってしまうため。
    expect(mockInvalidateQueries).toHaveBeenCalled();
    const chip = screen.getByTestId("work-detail-status-WATCHING");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("選択中のチップを再タップするとステータスを解除する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "watch_status_change",
      expect.objectContaining({ from: "WATCHING", to: "NO_STATE" }),
    );
    expect(mockDeleteAsync).toHaveBeenCalledWith(42);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("解除中は選択チップが外れた表示になる（楽観表示）", async () => {
    let resolveDelete: (v: unknown) => void = () => {};
    mockDeleteAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));

    const chip = screen.getByTestId("work-detail-status-WATCHING");
    expect(chip.props.accessibilityState?.selected).toBe(false);

    await act(async () => {
      resolveDelete({ success: true });
    });
  });

  it("解除に失敗したらダイアログで通知し選択を元に戻す", async () => {
    mockDeleteAsync.mockRejectedValue(
      new ApiRequestError(500, "視聴履歴の削除に失敗しました"),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));

    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    // 楽観値は下ろされ、サーバー値（WATCHING）の表示に戻る
    const chip = screen.getByTestId("work-detail-status-WATCHING");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("Annict 未連携ではステータス欄が連携導線に変わりチップを出さない", async () => {
    mockUseAnnictConnection.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });

    await render(sheetElement());

    expect(screen.getByTestId("work-detail-status-gate")).toBeTruthy();
    expect(screen.queryByTestId("work-detail-status-WATCHED")).toBeNull();
  });

  it("未連携ゲートの「連携する」で surface 付きの連携フローを開始する", async () => {
    mockUseAnnictConnection.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });
    mockConnect.mockResolvedValueOnce({ status: "success" });

    await render(sheetElement());
    await fireEvent.press(screen.getByLabelText("連携する"));

    expect(mockConnect).toHaveBeenCalledWith({
      surface: "work_detail_sheet",
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("連携状態の確認中はチップもゲートも出さない", async () => {
    mockUseAnnictConnection.mockReturnValue({
      isConnected: false,
      isLoading: true,
    });

    await render(sheetElement());

    expect(screen.queryByTestId("work-detail-status-gate")).toBeNull();
    expect(screen.queryByTestId("work-detail-status-WATCHED")).toBeNull();
  });

  it("annict_token_required の失敗は再連携プロンプトに委譲し汎用アラートを出さない", async () => {
    const tokenError = new ApiRequestError(
      401,
      "視聴履歴の更新に失敗しました",
      "annict_token_required",
    );
    mockMutateAsync.mockRejectedValue(tokenError);
    mockPromptAnnictTokenError.mockReturnValue(true);

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));

    expect(mockUseAnnictTokenErrorPrompt).toHaveBeenCalledWith(
      "work_detail_sheet",
    );
    expect(mockPromptAnnictTokenError).toHaveBeenCalledWith(tokenError);
    expect(mockAlert).not.toHaveBeenCalled();
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

  it("「Annict で見る」を押すと Annict の作品ページを開く", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(sheetElement());

    await fireEvent.press(screen.getByLabelText("Annict で見る"));

    expect(openURL).toHaveBeenCalledWith("https://annict.com/works/42");
  });

  it("詳細取得中や失敗時も Annict リンクを表示する", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: undefined, isLoading: true }),
    );
    await render(sheetElement());
    expect(screen.getByText("Annict で見る")).toBeTruthy();
  });

  it("annictWorkId が無い作品では Annict リンクを表示しない", async () => {
    await render(sheetElement({ work: { ...WORK, annictWorkId: 0 } }));

    expect(screen.queryByText("Annict で見る")).toBeNull();
  });

  it("「キャラ Tier 表を作る」を押すとシートを閉じて対象作品を onOpenCharacterTierList に渡す", async () => {
    const onOpenCharacterTierList = jest.fn();
    const onClose = jest.fn();
    await render(sheetElement({ onOpenCharacterTierList, onClose }));

    await fireEvent.press(
      screen.getByTestId("work-detail-character-tier-list"),
    );

    // Tier 表から戻ったとき一覧の上にシートが残らないよう先に閉じる。
    expect(onClose).toHaveBeenCalled();
    expect(onOpenCharacterTierList).toHaveBeenCalledWith(WORK);
  });
});
