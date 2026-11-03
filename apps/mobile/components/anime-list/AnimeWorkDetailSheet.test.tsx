import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

// 話数一覧の取得と記録・解除はフックのテストで検証する。シート側は
// 「チェック一覧の描画と操作の受け渡し」だけを見るため差し替える。
const mockUseWorkEpisodes = jest.fn();
const mockRecordEpisodeAsync = jest.fn();
const mockUnrecordEpisodeAsync = jest.fn();

jest.mock("@/lib/useWorkEpisodes", () => ({
  useWorkEpisodes: (...args: unknown[]) => mockUseWorkEpisodes(...args),
  useRecordEpisode: () => ({
    mutateAsync: mockRecordEpisodeAsync,
    isPending: false,
  }),
  useUnrecordEpisode: () => ({
    mutateAsync: mockUnrecordEpisodeAsync,
    isPending: false,
  }),
}));

// 評価の取得・保存・解除はフックのテストで検証する。シート側は
// 「チップの描画と操作の受け渡し・初回説明の出し分け」だけを見る。
const mockUseWorkRating = jest.fn();
const mockRatingUpsertAsync = jest.fn();
const mockRatingDeleteAsync = jest.fn();

jest.mock("@/lib/useWorkRating", () => ({
  useWorkRating: (...args: unknown[]) => mockUseWorkRating(...args),
  useUpsertWorkRating: () => ({
    mutateAsync: mockRatingUpsertAsync,
    isPending: false,
  }),
  useDeleteWorkRating: () => ({
    mutateAsync: mockRatingDeleteAsync,
    isPending: false,
  }),
  WORK_RATING_LABELS: { bad: "イマイチ", good: "良い", great: "最高" },
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

// GET /works/:id/episodes の応答形。watched は Annict viewerDidTrack 由来。
const EPISODES = {
  episodes: [
    {
      annictEpisodeId: 101,
      number: 1,
      numberText: "第1話",
      sortNumber: 1,
      title: "はじまり",
      watched: true,
      recordsCount: 1,
      lastRecordedAt: "2026-10-01T10:00:00.000Z",
    },
    {
      annictEpisodeId: 102,
      number: 2,
      numberText: "第2話",
      sortNumber: 2,
      title: null,
      watched: false,
      recordsCount: 0,
      lastRecordedAt: null,
    },
    {
      annictEpisodeId: 103,
      number: 3,
      numberText: "第3話",
      sortNumber: 3,
      title: null,
      watched: false,
      recordsCount: 0,
      lastRecordedAt: null,
    },
  ],
};

const episodesState = (overrides: Record<string, unknown> = {}) => ({
  data: EPISODES,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  ...overrides,
});

// GET /me/work-ratings/:annictWorkId の応答形。rating は D1 の保存済み
// 評価、annictRating は Annict レビュー由来の初期値候補（未保存）。
const ratingState = (overrides: Record<string, unknown> = {}) => ({
  data: { rating: null, annictRating: null },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  ...overrides,
});

// 視聴済み（WATCHED）の詳細。評価セクションはこの状態のときだけ出る。
const watchedDetail = () =>
  detailState({ data: { work: { ...DETAIL.work, state: "WATCHED" } } });

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
    mockUseWorkEpisodes.mockReturnValue(episodesState());
    mockRecordEpisodeAsync.mockResolvedValue({});
    mockUnrecordEpisodeAsync.mockResolvedValue({});
    mockUseWorkRating.mockReturnValue(ratingState());
    mockRatingUpsertAsync.mockResolvedValue({});
    mockRatingDeleteAsync.mockResolvedValue({});
    // 初回説明フラグは端末ローカル。各テストは未表示状態から始める。
    await AsyncStorage.clear();
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

  it("話数チェック一覧を表示し、視聴済みの話はチェック済みになる", async () => {
    await render(sheetElement());

    const watched = screen.getByTestId("episode-check-101");
    const unwatched = screen.getByTestId("episode-check-102");
    expect(watched.props.accessibilityState?.checked).toBe(true);
    expect(unwatched.props.accessibilityState?.checked).toBe(false);
    expect(screen.getByText("第1話")).toBeTruthy();
    expect(screen.getByText("第3話")).toBeTruthy();
  });

  it("「次の話を記録」は未視聴の先頭の話を記録する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-record-next"));

    // 第1話は視聴済みなので、未視聴の先頭 = 第2話(102) が記録対象。
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "episode_record",
      expect.objectContaining({ action: "record" }),
    );
    expect(mockRecordEpisodeAsync).toHaveBeenCalledWith(102);
    expect(mockUnrecordEpisodeAsync).not.toHaveBeenCalled();
  });

  it("未チェックの話を押すと記録する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));

    expect(mockRecordEpisodeAsync).toHaveBeenCalledWith(103);
  });

  it("チェック済みの話を押すと記録を解除する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-101"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "episode_record",
      expect.objectContaining({ action: "unrecord" }),
    );
    expect(mockUnrecordEpisodeAsync).toHaveBeenCalledWith(101);
    expect(mockRecordEpisodeAsync).not.toHaveBeenCalled();
  });

  it("全話視聴済みなら「全話記録済み」の無効ボタンを出す", async () => {
    mockUseWorkEpisodes.mockReturnValue(
      episodesState({
        data: {
          episodes: EPISODES.episodes.map((e) => ({ ...e, watched: true })),
        },
      }),
    );

    await render(sheetElement());

    const button = screen.getByTestId("episode-record-next");
    expect(screen.getByText("全話記録済み")).toBeTruthy();
    expect(button.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button);
    expect(mockRecordEpisodeAsync).not.toHaveBeenCalled();
  });

  it("話の記録に失敗したらダイアログで通知する", async () => {
    mockRecordEpisodeAsync.mockRejectedValue(
      new ApiRequestError(500, "話の記録に失敗しました"),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("episode-record-next"));

    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("話数取得に失敗したら再試行ボタンを出す", async () => {
    const refetch = jest.fn();
    mockUseWorkEpisodes.mockReturnValue(
      episodesState({ data: undefined, isError: true, refetch }),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("episode-list-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("話が 1 件も無い作品では話数セクションを出さない", async () => {
    mockUseWorkEpisodes.mockReturnValue(
      episodesState({ data: { episodes: [] } }),
    );

    await render(sheetElement());

    expect(screen.queryByTestId("episode-record-next")).toBeNull();
    expect(screen.queryByTestId("episode-check-101")).toBeNull();
  });

  it("Annict 未連携では話数セクションを出さない（連携導線のみ）", async () => {
    mockUseAnnictConnection.mockReturnValue({
      isConnected: false,
      isLoading: false,
    });

    await render(sheetElement());

    expect(screen.getByTestId("work-detail-status-gate")).toBeTruthy();
    expect(screen.queryByTestId("episode-record-next")).toBeNull();
    // 未連携のうちは話数一覧のクエリ自体を投げない
    expect(mockUseWorkEpisodes).not.toHaveBeenCalled();
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

  it("視聴済み作品に 3 段階の評価チップを表示する", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());

    await render(sheetElement());

    expect(screen.getByTestId("work-detail-rating-bad")).toBeTruthy();
    expect(screen.getByTestId("work-detail-rating-good")).toBeTruthy();
    expect(screen.getByTestId("work-detail-rating-great")).toBeTruthy();
    expect(screen.getByText("イマイチ")).toBeTruthy();
    expect(screen.getByText("良い")).toBeTruthy();
    expect(screen.getByText("最高")).toBeTruthy();
  });

  it("視聴済みでなく未評価の作品には評価セクションを出さない", async () => {
    // 既定の詳細は WATCHING、既定の評価は null。
    await render(sheetElement());

    expect(screen.queryByText("この作品の評価")).toBeNull();
    expect(screen.queryByTestId("work-detail-rating-bad")).toBeNull();
    expect(screen.queryByTestId("work-detail-rating-good")).toBeNull();
    expect(screen.queryByTestId("work-detail-rating-great")).toBeNull();
  });

  it("視聴済みでなくても保存済み評価があれば評価セクションを出す", async () => {
    // 評価は作品への意見なので、視聴済みから視聴中に戻しても残る。
    // 残った評価を外せるよう、セクションは出し続ける（PR #452 レビュー）。
    mockUseWorkDetail.mockReturnValue(detailState());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: "good", annictRating: null } }),
    );

    await render(sheetElement());

    expect(screen.getByText("この作品の評価")).toBeTruthy();
    expect(
      screen.getByTestId("work-detail-rating-good").props.accessibilityState
        ?.selected,
    ).toBe(true);
  });

  it("視聴中に戻した作品でも評価を外せる", async () => {
    mockUseWorkDetail.mockReturnValue(detailState());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: "good", annictRating: null } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-good"));

    expect(mockRatingDeleteAsync).toHaveBeenCalled();
    expect(mockRatingUpsertAsync).not.toHaveBeenCalled();
  });

  it("保存済みの評価が選択済みチップとして表示される", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: "great", annictRating: null } }),
    );

    await render(sheetElement());

    const chip = screen.getByTestId("work-detail-rating-great");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("Annict の評価は未保存でも初期値として選択表示される", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: null, annictRating: "good" } }),
    );

    await render(sheetElement());

    const chip = screen.getByTestId("work-detail-rating-good");
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  it("D1 の評価があれば Annict 初期値ではなく D1 を選択表示する", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: "bad", annictRating: "great" } }),
    );

    await render(sheetElement());

    expect(
      screen.getByTestId("work-detail-rating-bad").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      screen.getByTestId("work-detail-rating-great").props.accessibilityState
        ?.selected,
    ).toBe(false);
  });

  it("評価チップを押すと保存される", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-great"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "work_rating_change",
      expect.objectContaining({ from: "none", to: "great" }),
    );
    expect(mockRatingUpsertAsync).toHaveBeenCalledWith({ rating: "great" });
    expect(
      screen.getByTestId("work-detail-rating-great").props.accessibilityState
        ?.selected,
    ).toBe(true);
  });

  it("選択中のチップを再タップすると評価を解除する", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: "good", annictRating: null } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-good"));

    expect(mockRatingDeleteAsync).toHaveBeenCalled();
    expect(mockRatingUpsertAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("work-detail-rating-good").props.accessibilityState
        ?.selected,
    ).toBe(false);
  });

  it("Annict 初期値だけの選択を外しても削除 API は呼ばない", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: { rating: null, annictRating: "good" } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-good"));

    // Annict 初期値は未保存の候補なので、外すだけならサーバーに消すものが無い。
    expect(mockRatingDeleteAsync).not.toHaveBeenCalled();
    expect(mockRatingUpsertAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("work-detail-rating-good").props.accessibilityState
        ?.selected,
    ).toBe(false);
  });

  it("保存に失敗したらアラートを出して選択を元に戻す", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockRatingUpsertAsync.mockRejectedValue(
      Object.assign(new Error("fail"), { rolledBack: true }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-great"));

    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    expect(
      screen.getByTestId("work-detail-rating-great").props.accessibilityState
        ?.selected,
    ).toBe(false);
  });

  it("評価の取得に失敗したら再試行ボタンを出す", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    const refetch = jest.fn();
    mockUseWorkRating.mockReturnValue(
      ratingState({ data: undefined, isError: true, refetch }),
    );

    await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-rating-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("初回だけ「評価するとおすすめの精度が上がります」と説明を出す", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    const first = await render(sheetElement());

    // 説明文はフラグ読み込み後に出るため findBy で待つ。
    expect(
      await screen.findByText("評価するとおすすめの精度が上がります"),
    ).toBeTruthy();
    await first.unmount();

    // 表示済みフラグが端末に残ったため、開き直しても出ない。
    await render(sheetElement());
    expect(
      screen.queryByText("評価するとおすすめの精度が上がります"),
    ).toBeNull();
  });
});
