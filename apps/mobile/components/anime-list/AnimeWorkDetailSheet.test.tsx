import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, signedOutUser } from "@/test-utils/auth";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";
import type { WorkDetailSheetTarget } from "./AnimeWorkDetailSheet";

// 詳細取得（API / Annict 連携）とステータス更新はフックのテストで検証する。
// シート側は「描画と操作の受け渡し」だけを見るため、フックは状態ごとに
// 差し替えられるモックにする。
const mockUseWorkDetail = jest.fn();
const mockMutateAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockPush = jest.fn();
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

// シーズンチップ（issue #535）のライブラリタブへの遷移を捕捉する。
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// BottomSheet は拡張子解決でプラットフォーム実装に分かれ、呼び出し側が
// 渡した props（closeButtonAccessibilityLabel 等）は実装側で取り除かれて
// ホスト要素に残らない。ここでは props をそのまま描画するモックに
// 差し替え、シート側の受け渡しを検証できるようにする。
jest.mock("@/components/ui/bottom-sheet", () => {
  const { View } = jest.requireActual("react-native");
  const { createElement } = jest.requireActual("react");
  return {
    BottomSheet: ({
      visible,
      children,
      ...props
    }: {
      visible?: boolean;
      children?: React.ReactNode;
    }) => (visible ? createElement(View, props, children) : null),
  };
});

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
    staffs: [],
    casts: [],
  },
};

// クレジット（issue #536）を持つ詳細応答。主要役職・非主要役職（roleOther
// 由来の自由記述）・団体（制作会社）と、キャラ付き/キャラ無しのキャストを
// 混ぜて、出し分けとラベル・リンク先を検証する。
const CREDITS = {
  staffs: [
    {
      annictStaffId: 501,
      name: "山田 監督",
      role: "監督",
      resource: { kind: "person", annictId: 101 },
    },
    {
      annictStaffId: 502,
      name: "テスト制作",
      role: "アニメーション制作",
      resource: { kind: "organization", annictId: 202 },
    },
    {
      annictStaffId: 503,
      name: "企画プロ",
      role: "企画",
      resource: { kind: "organization", annictId: 203 },
    },
    {
      annictStaffId: 504,
      name: "佐藤 演出",
      role: "演出",
      resource: { kind: "person", annictId: 103 },
    },
  ],
  casts: [
    {
      annictCastId: 601,
      annictPersonId: 301,
      personName: "声優 一郎",
      characterName: "主人公",
      sortNumber: 1,
    },
    ...Array.from({ length: 11 }, (_, i) => ({
      annictCastId: 602 + i,
      annictPersonId: 302 + i,
      personName: `声優 ${i + 2}郎`,
      characterName: `キャラ${i + 2}`,
      sortNumber: i + 2,
    })),
  ],
};

const creditsDetail = () =>
  detailState({ data: { work: { ...DETAIL.work, ...CREDITS } } });

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
    work?: WorkDetailSheetTarget | null;
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
    loggedInUser();
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

  it("作品リストへの追加と d アニメストア検索を詳細から選べる", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(sheetElement());
    expect(screen.getByTestId("work-detail-add-to-list")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("work-detail-danime-search"));
    expect(openURL).toHaveBeenCalledWith(
      `https://animestore.docomo.ne.jp/animestore/sch_pc?searchKey=${encodeURIComponent(WORK.title)}`,
    );
    openURL.mockRestore();
  });

  it("ステータスの保存中と完了を操作欄に表示する", async () => {
    let finish: (value: unknown) => void = () => {};
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));
    expect(screen.getByText("保存中…")).toBeTruthy();

    await act(async () => {
      finish({});
    });
    expect(screen.getByText("保存しました")).toBeTruthy();
  });

  it("評価と話数の保存中と完了をそれぞれの操作欄に表示する", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    let finishRating: (value: unknown) => void = () => {};
    let finishEpisode: (value: unknown) => void = () => {};
    mockRatingUpsertAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRating = resolve;
        }),
    );
    mockRecordEpisodeAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishEpisode = resolve;
        }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-rating-good"));
    expect(screen.getByTestId("work-rating-save-feedback").props.children).toBe(
      "保存中…",
    );
    await act(async () => {
      finishRating({});
    });
    expect(screen.getByTestId("work-rating-save-feedback").props.children).toBe(
      "保存しました",
    );

    await fireEvent.press(screen.getByTestId("episode-record-next"));
    expect(screen.getByTestId("episode-save-feedback").props.children).toBe(
      "保存中…",
    );
    await act(async () => {
      finishEpisode({});
    });
    expect(screen.getByTestId("episode-save-feedback").props.children).toBe(
      "保存しました",
    );
  });

  it("視聴済みでも話数の視聴記録が別に必要なことを示す", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    mockUseWorkEpisodes.mockReturnValue(
      episodesState({
        data: {
          episodes: EPISODES.episodes.map((episode) => ({
            ...episode,
            watched: false,
          })),
        },
      }),
    );
    await render(sheetElement());

    expect(
      screen.getByText(
        "視聴ステータスと話数の記録は別です。未記録の話を記録できます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("第1話の視聴を記録")).toBeTruthy();
  });

  it("別作品へ切り替えたら前の作品の保存結果を表示しない", async () => {
    mockUseWorkDetail.mockReturnValue(watchedDetail());
    const { rerender } = await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WANNA_WATCH"));
    await fireEvent.press(screen.getByTestId("work-detail-rating-good"));
    await fireEvent.press(screen.getByTestId("episode-record-next"));
    await act(async () => {});

    await rerender(sheetElement({ work: { ...WORK, annictWorkId: 43 } }));
    expect(screen.queryByTestId("status-save-feedback")).toBeNull();
    expect(screen.queryByTestId("work-rating-save-feedback")).toBeNull();
    expect(screen.queryByTestId("episode-save-feedback")).toBeNull();

    // A→B→A と戻ったときも再表示しない。セクションは同じ位置に残るため、
    // 作品ごとに state を破棄しないと A の「保存しました」が残ったまま
    // React に再利用される。
    await rerender(sheetElement());
    expect(screen.queryByTestId("status-save-feedback")).toBeNull();
    expect(screen.queryByTestId("work-rating-save-feedback")).toBeNull();
    expect(screen.queryByTestId("episode-save-feedback")).toBeNull();
  });

  it("先行する保存の完了が後続操作の保存中表示を上書きしない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    const resolvers: Array<(value: unknown) => void> = [];
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    await render(sheetElement());

    // 未設定の作品で「視聴中」の保存が残ったまま最終話の記録が終わると、
    // 自動更新（issue #467）が後続で「視聴済み」の保存を開始する。
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));
    await fireEvent.press(screen.getByTestId("episode-check-103"));
    await act(async () => {});
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存中…",
    );

    // 先行する「視聴中」の保存が完了しても、後続の保存中は完了表示にしない。
    await act(async () => {
      resolvers[0]?.({});
    });
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存中…",
    );

    // 後続の保存が完了して初めて完了表示に変わる。
    await act(async () => {
      resolvers[1]?.({});
    });
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存しました",
    );
  });

  it("先行する保存の失敗が後続操作の保存中表示を上書きしない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    const resolvers: Array<(value: unknown) => void> = [];
    const rejecters: Array<(reason: unknown) => void> = [];
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          resolvers.push(resolve);
          rejecters.push(reject);
        }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHING"));
    await fireEvent.press(screen.getByTestId("episode-check-103"));
    await act(async () => {});
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);

    // 先行する「視聴中」の保存が失敗しても、後続の保存中は失敗表示にしない。
    // 失敗自体の通知（ダイアログ）は従来どおり出す。
    await act(async () => {
      rejecters[0]?.(new ApiRequestError(500, "視聴履歴の更新に失敗しました"));
    });
    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存中…",
    );

    await act(async () => {
      resolvers[1]?.({});
    });
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存しました",
    );
  });

  it("同じ作品を開き直したら前回の保存結果を表示しない", async () => {
    const view = await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存しました",
    );

    await view.rerender(sheetElement({ work: null }));
    await view.rerender(sheetElement());
    expect(screen.queryByTestId("status-save-feedback")).toBeNull();
  });

  it("閉じる前の保存が後から完了しても開き直した作品に結果を表示しない", async () => {
    let finish: (value: unknown) => void = () => {};
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await render(sheetElement());
    await fireEvent.press(screen.getByTestId("work-detail-status-WATCHED"));

    await view.rerender(sheetElement({ work: null }));
    await view.rerender(sheetElement());
    await act(async () => {
      finish({});
    });
    expect(screen.queryByTestId("status-save-feedback")).toBeNull();
  });

  it("作品詳細に中間の高さと全画面の停止位置を指定する", async () => {
    await render(sheetElement());
    expect(
      screen.getByTestId("anime-work-detail-sheet").props.snapPoints,
    ).toEqual([{ fraction: 0.8 }, "full"]);
  });

  it("Web シート右上の閉じるボタン用のラベルを BottomSheet へ渡す", async () => {
    // Web にはスワイプで閉じる手段が無いため、カード右上に実体の
    // 閉じるボタンを出す（issue #529）。ボタン自体の描画とクリックは
    // BottomSheet.web.test.tsx で検証する。
    await render(sheetElement());
    expect(
      screen.getByTestId("anime-work-detail-sheet").props
        .closeButtonAccessibilityLabel,
    ).toBe("作品詳細を閉じる");
  });

  it("work が null のときシートを表示しない", async () => {
    await render(sheetElement({ work: null }));

    expect(screen.queryByTestId("anime-work-detail-sheet")).toBeNull();
  });

  it("作品の画像・タイトル（日英）・シーズン・メディア種別を表示する", async () => {
    await render(sheetElement());

    expect(screen.getByText("テストアニメ")).toBeTruthy();
    expect(screen.getByText("Test Anime")).toBeTruthy();
    // シーズンは同時期の作品一覧へ移るチップ（issue #535）として出す。
    expect(screen.getByTestId("work-detail-season-chip")).toBeTruthy();
    expect(screen.getByText("2026年 春")).toBeTruthy();
    expect(screen.getByTestId("work-detail-year-chip")).toBeTruthy();
    expect(screen.getByText("TV")).toBeTruthy();
    expect(screen.getByLabelText("テストアニメのサムネイル")).toBeTruthy();
  });

  it("シーズンチップを押すとシートを閉じて同じシーズンの一覧へ移る（issue #535）", async () => {
    const onClose = jest.fn();
    await render(sheetElement({ onClose }));

    await fireEvent.press(screen.getByTestId("work-detail-season-chip"));

    // 一覧へ移ったあともシートが残らないよう先に閉じる。
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/library",
      params: {
        section: "anime",
        season: "2026-spring",
        nav: expect.any(String),
      },
    });
  });

  it("年チップを押すとその年の通年の一覧へ移る（issue #535）", async () => {
    const onClose = jest.fn();
    await render(sheetElement({ onClose }));

    await fireEvent.press(screen.getByTestId("work-detail-year-chip"));

    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/library",
      params: {
        section: "anime",
        season: "2026",
        nav: expect.any(String),
      },
    });
  });

  it("seasonYear のみの作品は年チップだけを出す", async () => {
    await render(sheetElement({ work: { ...WORK, seasonName: null } }));

    expect(screen.queryByTestId("work-detail-season-chip")).toBeNull();
    expect(screen.getByTestId("work-detail-year-chip")).toBeTruthy();
  });

  it("seasonYear / seasonName が無い作品ではチップを出さない", async () => {
    await render(
      sheetElement({ work: { ...WORK, seasonYear: null, seasonName: null } }),
    );

    expect(screen.queryByTestId("work-detail-season-chip")).toBeNull();
    expect(screen.queryByTestId("work-detail-year-chip")).toBeNull();
    // メディア種別の表示はシーズンとは独立に残る。
    expect(screen.getByText("TV")).toBeTruthy();
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
    expect(screen.getByTestId("status-save-feedback").props.children).toBe(
      "保存できませんでした",
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

  it("主要役職のスタッフと先頭のキャストをチップで表示する（issue #536）", async () => {
    mockUseWorkDetail.mockReturnValue(creditsDetail());
    await render(sheetElement());

    // スタッフは役職付き、キャストは演じたキャラクター名付きで出す。
    expect(screen.getByText("監督：山田 監督")).toBeTruthy();
    expect(screen.getByText("アニメーション制作：テスト制作")).toBeTruthy();
    expect(screen.getByText("声優 一郎（主人公）")).toBeTruthy();
    // 団体（制作会社）は役職ラベルが主要でなくても常時表示する。
    expect(screen.getByText("企画：企画プロ")).toBeTruthy();
    // 主要役職以外のスタッフ（人物）と INITIAL_CAST_COUNT 以降のキャストは
    // 「もっと見る」で開くまでは出さない。
    expect(screen.queryByText("演出：佐藤 演出")).toBeNull();
    expect(screen.queryByText("声優 12郎（キャラ12）")).toBeNull();
    expect(screen.getByTestId("work-detail-credits-toggle")).toBeTruthy();
  });

  it("キャラクター名が無いキャストは声優名だけで表示する", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({
        data: {
          work: {
            ...DETAIL.work,
            casts: [
              {
                annictCastId: 601,
                annictPersonId: 301,
                personName: "声優 一郎",
                characterName: null,
                sortNumber: 1,
              },
            ],
          },
        },
      }),
    );
    await render(sheetElement());

    expect(screen.getByText("声優 一郎")).toBeTruthy();
    expect(screen.queryByText(/（/)).toBeNull();
  });

  it("「もっと見る」を押すと残りのスタッフ・キャストをすべて表示する", async () => {
    mockUseWorkDetail.mockReturnValue(creditsDetail());
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("work-detail-credits-toggle"));

    expect(screen.getByText("演出：佐藤 演出")).toBeTruthy();
    expect(screen.getByText("声優 12郎（キャラ12）")).toBeTruthy();
    // 展開後は折りたたみに切り替わる。
    expect(screen.getByText("折りたたむ")).toBeTruthy();
  });

  it("スタッフチップを押すと Annict の人物・団体ページを開く", async () => {
    mockUseWorkDetail.mockReturnValue(creditsDetail());
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(sheetElement());

    await fireEvent.press(screen.getByText("監督：山田 監督"));
    expect(openURL).toHaveBeenCalledWith("https://annict.com/people/101");

    await fireEvent.press(screen.getByText("アニメーション制作：テスト制作"));
    expect(openURL).toHaveBeenCalledWith(
      "https://annict.com/organizations/202",
    );
  });

  it("キャストチップを押すと Annict の人物ページを開く", async () => {
    mockUseWorkDetail.mockReturnValue(creditsDetail());
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(sheetElement());

    await fireEvent.press(screen.getByText("声優 一郎（主人公）"));

    expect(openURL).toHaveBeenCalledWith("https://annict.com/people/301");
  });

  it("スタッフ・キャストが無い作品ではクレジットのセクションを出さない", async () => {
    await render(sheetElement());

    expect(screen.queryByText("スタッフ・制作会社")).toBeNull();
    expect(screen.queryByText("キャスト")).toBeNull();
    expect(screen.queryByTestId("work-detail-credits-toggle")).toBeNull();
  });

  it("フィールド追加前のキャッシュ（staffs / casts 無し）でもシートが開ける", async () => {
    // 詳細クエリは端末の永続キャッシュから復元されるため、staffs / casts
    // 追加前の応答が新しい画面に渡りうる。undefined のまま渡されても
    // 空配列に正規化して描画を続ける。
    mockUseWorkDetail.mockReturnValue(
      detailState({
        data: {
          work: { ...DETAIL.work, staffs: undefined, casts: undefined },
        },
      }),
    );

    await render(sheetElement());

    expect(screen.getByText("テストアニメ")).toBeTruthy();
    expect(screen.queryByTestId("work-detail-credits-toggle")).toBeNull();
  });

  it("「作品ページを見る」を押すとシートを閉じて animeishi の作品ページへ移る", async () => {
    const onClose = jest.fn();
    await render(sheetElement({ onClose }));

    await fireEvent.press(screen.getByTestId("work-detail-open-page"));

    // 作品ページから戻ったときにシートが残らないよう先に閉じる。
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/work/[id]",
      params: { id: "42" },
    });
  });

  it("詳細取得中や失敗時も作品ページへの導線を表示する", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: undefined, isLoading: true }),
    );
    await render(sheetElement());
    expect(screen.getByText("作品ページを見る")).toBeTruthy();
  });

  it("未ログインの閲覧者には作品ページではなく Annict へのリンクを出す", async () => {
    signedOutUser();
    // 未ログインでは useWorkDetail が無効になり詳細は取れない。
    mockUseWorkDetail.mockReturnValue(detailState({ data: undefined }));
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(sheetElement());

    expect(screen.queryByTestId("work-detail-open-page")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Annict で見る"));
    expect(openURL).toHaveBeenCalledWith("https://annict.com/works/42");
  });

  it("annictWorkId が無い作品では作品ページへの導線を表示しない", async () => {
    await render(sheetElement({ work: { ...WORK, annictWorkId: 0 } }));

    expect(screen.queryByTestId("work-detail-open-page")).toBeNull();
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

    // 第1話は視聴済みなので、未視聴の先頭 = 第2話(102) だけが記録対象。
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "episode_record",
      expect.objectContaining({ action: "record" }),
    );
    expect(mockRecordEpisodeAsync).toHaveBeenCalledTimes(1);
    expect(mockRecordEpisodeAsync).toHaveBeenCalledWith(102);
    expect(mockUnrecordEpisodeAsync).not.toHaveBeenCalled();
  });

  it("後ろの話をチェックするとそれ以前の未記録分もまとめて記録する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));

    // 第3話のチェックで、それより前の未記録分（102）も順に記録する。
    // 記録済みの 101 は送らない（issue #466）。
    expect(mockRecordEpisodeAsync.mock.calls).toEqual([[102], [103]]);
    expect(mockUnrecordEpisodeAsync).not.toHaveBeenCalled();
  });

  it("チェック済みの話を押すとタップした 1 話だけ記録を解除する", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-101"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "episode_record",
      expect.objectContaining({ action: "unrecord" }),
    );
    // 解除はまとめて消えず、タップした話だけが対象（issue #466）。
    expect(mockUnrecordEpisodeAsync).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId("episode-save-feedback").props.children).toBe(
      "保存できませんでした",
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

  it("ステータス未設定で話を記録すると「視聴中」にする", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-102"));

    // issue #467: 記録できた話があるのにステータス未設定なら視聴中にする。
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        annictWorkId: 42,
        data: { state: "WATCHING" },
      }),
    );
  });

  it("全話が記録済みになると「視聴済み」にする", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        annictWorkId: 42,
        data: { state: "WATCHED" },
      }),
    );
  });

  it("「視聴中」から全話記録済みになったら「視聴済み」にする", async () => {
    // 既定の詳細 state は WATCHING。
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        annictWorkId: 42,
        data: { state: "WATCHED" },
      }),
    );
  });

  it("「視聴中」のまま途中までの記録ではステータスを変えない", async () => {
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-102"));
    await act(async () => {});

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("視聴予定など明示的なステータスは記録で上書きしない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: "WANNA_WATCH" } } }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));
    await act(async () => {});

    // 話の記録自体は走るが、ステータスの upsert は送らない
    // （issue #467 の方針決定: 明示的に付けたステータスは上書きしない）。
    expect(mockRecordEpisodeAsync).toHaveBeenCalledWith(103);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("一部の話の記録に失敗しても、残りが記録できていれば未設定から「視聴中」にする", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    mockRecordEpisodeAsync
      .mockRejectedValueOnce(new ApiRequestError(500, "話の記録に失敗しました"))
      .mockResolvedValue({});
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));

    // 102 は失敗・103 は記録できたため全話揃わず、未設定 → 視聴中 に進める。
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        annictWorkId: 42,
        data: { state: "WATCHING" },
      }),
    );
    // 失敗分の通知はまとめて 1 件出す。
    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("記録が全滅したらステータスは変えない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    mockRecordEpisodeAsync.mockRejectedValue(
      new ApiRequestError(500, "話の記録に失敗しました"),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-102"));
    await act(async () => {});

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(
      "更新できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("記録の完了前に別ステータスを選んだ作品は自動更新で上書きしない", async () => {
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: { work: { ...DETAIL.work, state: null } } }),
    );
    // 記録を保留にして、完了前にチップで「視聴予定」を選ぶ。
    const resolvers: Array<(v: unknown) => void> = [];
    mockRecordEpisodeAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    // チップ側の upsert も保留にして、楽観値の「視聴予定」を維持する。
    mockMutateAsync.mockImplementation(() => new Promise(() => {}));
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));
    await fireEvent.press(screen.getByTestId("work-detail-status-WANNA_WATCH"));

    await act(async () => {
      resolvers.forEach((resolve) => resolve({ recorded: true }));
    });

    // 送られるのはユーザーが選んだ「視聴予定」だけ。
    // 判定は記録完了時点の最新 state なので自動の「視聴済み」は発火しない。
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      annictWorkId: 42,
      data: { state: "WANNA_WATCH" },
    });
  });

  it("詳細の取得が終わる前に話を記録してもステータスは変えない", async () => {
    // 話数一覧だけ先に届き detail.data がまだ無い状態。state=null は
    // 「未設定」ではなく「未取得」を意味するため、明示ステータスを
    // 「視聴中」で上書きしない。
    mockUseWorkDetail.mockReturnValue(
      detailState({ data: undefined, isLoading: true }),
    );
    await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-102"));
    await act(async () => {});

    expect(mockRecordEpisodeAsync).toHaveBeenCalledWith(102);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("記録の完了前に別作品へ切り替わったらその作品のステータスを変えない", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    mockRecordEpisodeAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { rerender } = await render(sheetElement());

    await fireEvent.press(screen.getByTestId("episode-check-103"));
    expect(mockRecordEpisodeAsync).toHaveBeenCalled();

    // 記録の直列実行が残ったまま別作品へ切り替える。
    await rerender(sheetElement({ work: { ...WORK, annictWorkId: 43 } }));

    await act(async () => {
      resolvers.forEach((resolve) => resolve({ recorded: true }));
    });

    // 完了通知は記録開始時の作品のものなので、今開いている作品へ
    // ステータスは送らない。
    expect(mockMutateAsync).not.toHaveBeenCalled();
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
    expect(screen.getByTestId("work-rating-save-feedback").props.children).toBe(
      "保存できませんでした",
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
