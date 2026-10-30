// 視聴履歴セクション（ライブラリタブ内）のテスト。
// ステータス変更は行のピッカーで即時保存し、「元に戻す」トーストで
// 取り消せる（issue #379）。編集モーダルの「選択 → 保存」は廃止。
// dアニメ取り込み導線は featureFlags.danimeImport で制御する（#158）:
// 無効（ネイティブ既定）ではボタンを出さず、有効（Web 版）では従来通り出す。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { WatchHistorySection } from "@/components/library/WatchHistorySection";
import { ApiRequestError } from "@/lib/apiError";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// フラグをテストごとに切り替えられるよう getter で遅延評価する。
let mockDanimeImport = false;
jest.mock("@/lib/featureFlags", () => ({
  get featureFlags() {
    return {
      debugPanel: false,
      wallet: false,
      danimeImport: mockDanimeImport,
    };
  },
}));

// mutateAsync の振る舞いをテストごとに差し替えられるよう遅延参照する。
const mockUpsertMutateAsync = jest.fn();
const mockRemoveMutateAsync = jest.fn();
// 履歴の中身もテストごとに差し替えられるよう遅延参照する。
// 既定は従来テストと同じ 1 件構成。
let mockHistories: unknown[] = [
  { annictWorkId: 1, title: "テスト作品", state: "WATCHED" },
];
jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({
    data: mockHistories,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpsertWatchHistory: () => ({
    mutateAsync: (...args: unknown[]) => mockUpsertMutateAsync(...args),
  }),
  useDeleteWatchHistory: () => ({
    mutateAsync: (...args: unknown[]) => mockRemoveMutateAsync(...args),
  }),
  WATCH_STATUS_LABELS: {
    WATCHING: "視聴中",
    WATCHED: "視聴済",
    ON_HOLD: "一時停止",
    STOP_WATCHING: "断念",
    WANNA_WATCH: "視聴予定",
  },
}));

// 推し（お気に入り）の状態・トグルをテストごとに差し替えられるようにする（#379）。
let mockFavoriteIds = new Set<number>();
const mockToggleFavorite = jest.fn();
jest.mock("@/lib/useFavorites", () => ({
  useFavoriteIds: () => mockFavoriteIds,
  useToggleFavorite: () => ({
    toggle: (annictWorkId: number) => mockToggleFavorite(annictWorkId),
    isPending: false,
  }),
}));

// 「リストに追加」シートは API 取得を伴うためスタブにする。対象作品を開いた
// ことだけ検証する（シート自体の振る舞いは components/work-list のテスト側）。
jest.mock("@/components/work-list", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable, Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AddToWorkListButton: ({
      onPress,
      title,
      testID,
    }: {
      onPress: () => void;
      title: string;
      testID?: string;
    }) =>
      React.createElement(Pressable, {
        onPress,
        testID,
        accessibilityRole: "button",
        accessibilityLabel: `${title}をリストに追加`,
      }),
    AddToWorkListSheet: ({ work }: { work: { title: string } | null }) =>
      work
        ? React.createElement(
            Text,
            { testID: "add-to-work-list-sheet" },
            work.title,
          )
        : null,
  };
});

jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => ({ isConnected: true, isLoading: false }),
}));

// 共有 URL 導線（WatchHistoryShareSection）のフック。画面のテストでは
// 共有状態を未発行に固定し、発行・解除は実際には呼ばれないスタブにする。
jest.mock("@/lib/useWatchHistoryShare", () => ({
  useWatchHistoryShareStatus: () => ({
    data: { shareToken: null },
    isLoading: false,
  }),
  useShareWatchHistory: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUnshareWatchHistory: () => ({ mutateAsync: jest.fn(), isPending: false }),
  buildWatchHistoryShareUrl: (token: string, base: string) =>
    `${base}/share/watch-history/${token}`,
}));

// 更新失敗通知は lib/dialog の alert に載せ替えた（トースト廃止）。
// mock では onClose を呼ばないため、alert 呼び出し後は「ダイアログが
// 開いたまま」の状態として扱える。
// confirm は「ユーザーが承諾した」として即座に onConfirm を呼ぶ。
const mockAlert = jest.fn();
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);
jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));
jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: () => null,
}));
jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

// フックの onError が「表示を実際に巻き戻したか」をエラーへ記録する
// rolledBack フラグを模倣した reject 値を作る。
function rejectedUpsertError(rolledBack: boolean) {
  const e = new ApiRequestError(
    500,
    "視聴履歴の更新に失敗しました",
  ) as ApiRequestError & { rolledBack?: boolean };
  e.rolledBack = rolledBack;
  return e;
}

// 行のステータスピッカーを開いて指定ステータスを選ぶ。
async function pickStatus(annictWorkId: number, state: string) {
  await fireEvent.press(
    screen.getByTestId(`watch-history-status-${annictWorkId}-button`),
  );
  await fireEvent.press(
    screen.getByTestId(`watch-history-status-${annictWorkId}-option-${state}`),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockDanimeImport = false;
  mockHistories = [{ annictWorkId: 1, title: "テスト作品", state: "WATCHED" }];
  mockFavoriteIds = new Set();
  mockUpsertMutateAsync.mockReset();
  mockRemoveMutateAsync.mockReset();
  mockToggleFavorite.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  // 実際のフックは楽観更新で選んだステータスが即座に一覧へ反映されるため、
  // 既定実装でも state をモックデータへ書き戻して同じ見え方にする
  // （「元に戻す」の直前状態判定がこれを参照する）。
  mockUpsertMutateAsync.mockImplementation(
    ({
      annictWorkId,
      data,
    }: {
      annictWorkId: number;
      data: { state: string };
    }) => {
      const item = mockHistories.find(
        (h) => (h as { annictWorkId: number }).annictWorkId === annictWorkId,
      ) as { state?: string } | undefined;
      if (item) item.state = data.state;
      return Promise.resolve({});
    },
  );
  mockRemoveMutateAsync.mockResolvedValue(null);
});

describe("WatchHistorySection", () => {
  it("フラグ無効（ネイティブ）では dアニメ取り込み導線を表示しない", async () => {
    await render(<WatchHistorySection />);

    expect(screen.getByTestId("watch-history-item-1")).toBeTruthy();
    expect(screen.queryByTestId("danime-import-button")).toBeNull();
  });

  it("フラグ有効（Web 版）では導線を表示し取り込み画面へ遷移する", async () => {
    mockDanimeImport = true;
    await render(<WatchHistorySection />);

    await fireEvent.press(screen.getByTestId("danime-import-button"));

    expect(mockPush).toHaveBeenCalledWith("/danime-import");
  });

  it("ピッカーでステータスを選ぶとその時点で保存され「元に戻す」トーストが出る", async () => {
    // API 応答が帰らない状態を再現するため pending のままにする。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");

    // 「選択 → 保存」の 2 段階は無く、選んだ時点で発行される。
    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      annictWorkId: 1,
      data: { state: "WATCHING" },
    });
    expect(
      screen.getByText("テスト作品を「視聴中」に変更しました"),
    ).toBeTruthy();
    expect(screen.getByTestId("watch-history-status-undo")).toBeTruthy();
  });

  it("「元に戻す」を押すと直前のステータスで保存し直してトーストが閉じる", async () => {
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");
    await fireEvent.press(screen.getByTestId("watch-history-status-undo"));

    expect(mockUpsertMutateAsync).toHaveBeenLastCalledWith({
      annictWorkId: 1,
      data: { state: "WATCHED" },
    });
    expect(screen.queryByTestId("watch-history-status-undo")).toBeNull();
  });

  it("現在と同じステータスを選んでも保存せずトーストも出さない", async () => {
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHED");

    expect(mockUpsertMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("watch-history-status-undo")).toBeNull();
  });

  it("トーストは一定時間で自動で消える", async () => {
    await render(<WatchHistorySection />);
    await pickStatus(1, "WATCHING");
    expect(screen.getByTestId("watch-history-status-undo")).toBeTruthy();

    // 実タイマーで待つ（フェイクタイマーは RN の描画系と相性が悪く、
    // 後続テストを汚染するため使わない）。
    await waitFor(
      () =>
        expect(screen.queryByTestId("watch-history-status-undo")).toBeNull(),
      { timeout: 6000 },
    );
  }, 10000);

  it("更新に失敗したらロールバックを知らせるダイアログを出す", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");

    // OK を押すまで消えないダイアログで「元の状態に戻した」ことまで伝える。
    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "更新できませんでした",
        "視聴ステータスを更新できませんでした。元の状態に戻しました。",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("前回の更新が pending 中でも次のステータス変更を発行できる", async () => {
    // 楽観更新は連続編集を許容する設計のため、pending 中の変更を無効化
    // しない（item 単位ロールバック＋スコープ直列化で整合性を保つ）。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");
    // 1 回目が pending のまま次の選択を発行できる。
    await pickStatus(1, "ON_HOLD");

    expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockUpsertMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");

    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));
    expect(mockAlert.mock.calls[0][1]).not.toContain("Network request failed");
  });

  it("表示中に起きた同種の失敗は閉じたあと件数でまとめて通知する", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    await render(<WatchHistorySection />);

    // 1回目の失敗でダイアログが出る（mock は onClose を呼ばないので開いたまま）。
    await pickStatus(1, "WATCHING");
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));

    // 表示中に同じ種類の失敗が重なっても、都度ダイアログは出さずキューに積む。
    await pickStatus(1, "ON_HOLD");
    await pickStatus(1, "WANNA_WATCH");
    await waitFor(() => expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(3));
    // catch のマイクロタスク完了を待ってから回数を確定させる。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // ダイアログを閉じると、キューの2件が「2件」にまとめて1回だけ出る。
    const options = mockAlert.mock.calls[0][2] as { onClose?: () => void };
    options.onClose?.();
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(2));
    expect(mockAlert.mock.calls[1][1]).toBe(
      "2件の視聴ステータス更新に失敗しました。",
    );
  });

  it("ダイアログを閉じた後の失敗では再度通知する", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));

    // ユーザーが OK で閉じる（onClose 発火）と次の失敗でまた出る。
    const options = mockAlert.mock.calls[0][2] as { onClose?: () => void };
    options.onClose?.();

    await pickStatus(1, "ON_HOLD");
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(2));
  });

  it("表示中の別種の失敗も捨てずに閉じたあと通知する", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    mockRemoveMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "視聴履歴の削除に失敗しました"),
    );
    await render(<WatchHistorySection />);

    // 更新失敗のダイアログが開く（mock は onClose を呼ばないので開いたまま）。
    await pickStatus(1, "WATCHING");
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));

    // 表示中に削除が失敗しても捨てず、キューに積む。
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を削除"));
    await waitFor(() => expect(mockRemoveMutateAsync).toHaveBeenCalledWith(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // 更新ダイアログを閉じると、キューの削除失敗が出る。
    const options = mockAlert.mock.calls[0][2] as { onClose?: () => void };
    options.onClose?.();
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(2));
    expect(mockAlert.mock.calls[1][0]).toBe("削除できませんでした");
  });

  it("巻き戻さなかった失敗は「元の状態に戻しました」とは言わない", async () => {
    // 後続の楽観値が残る失敗は onError がロールバックをスキップするため
    // rolledBack は付かない。その場合に「戻した」と誤表示しない。
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(false));
    await render(<WatchHistorySection />);

    await pickStatus(1, "WATCHING");

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "更新できませんでした",
        "一部の更新に失敗しました。",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  describe("行の操作（issue #379）", () => {
    it("各行に推し・リスト追加のボタンがある", async () => {
      mockFavoriteIds = new Set([1]);
      await render(<WatchHistorySection />);

      // 登録済みなら解除導線のラベルになる。
      expect(
        screen.getByLabelText("テスト作品をお気に入りから解除"),
      ).toBeTruthy();
      expect(screen.getByTestId("watch-history-add-to-list-1")).toBeTruthy();
    });

    it("推しボタンを押すとその作品のトグルが呼ばれる", async () => {
      await render(<WatchHistorySection />);

      await fireEvent.press(
        screen.getByLabelText("テスト作品をお気に入りに追加"),
      );

      expect(mockToggleFavorite).toHaveBeenCalledWith(1);
    });

    it("「リストに追加」ボタンでその作品を対象にしたシートが開く", async () => {
      await render(<WatchHistorySection />);
      expect(screen.queryByTestId("add-to-work-list-sheet")).toBeNull();

      await fireEvent.press(screen.getByTestId("watch-history-add-to-list-1"));

      expect(screen.getByTestId("add-to-work-list-sheet")).toBeTruthy();
    });
  });

  describe("ソート・絞り込み（issue #345）", () => {
    beforeEach(() => {
      mockHistories = [
        {
          annictWorkId: 1,
          title: "旧作",
          state: "WATCHED",
          seasonYear: 1998,
          watchersCount: 10,
        },
        {
          annictWorkId: 2,
          title: "人気作",
          state: "WATCHING",
          seasonYear: 2024,
          watchersCount: 5000,
        },
        {
          annictWorkId: 3,
          title: "新作",
          state: "WANNA_WATCH",
          seasonYear: 2025,
          watchersCount: 100,
        },
      ];
    });

    // FlatList の行の出現順を annictWorkId の並びとして取り出す。
    const renderedOrder = () =>
      screen
        .getAllByTestId(/^watch-history-item-\d+$/)
        .map((node) => node.props.testID.replace("watch-history-item-", ""));

    it("ソートチップで放送年順・視聴者数順に並べ替わる", async () => {
      await render(<WatchHistorySection />);

      // 既定は更新日順（API 応答の並びそのまま）。
      expect(renderedOrder()).toEqual(["1", "2", "3"]);

      await fireEvent.press(
        screen.getByTestId("watch-history-sort-seasonYear"),
      );
      expect(renderedOrder()).toEqual(["3", "2", "1"]);

      await fireEvent.press(
        screen.getByTestId("watch-history-sort-watchersCount"),
      );
      expect(renderedOrder()).toEqual(["2", "3", "1"]);
    });

    it("ソートチップ行は Web で高さが潰れないよう flex の伸縮を無効にする", async () => {
      // react-native-web の ScrollView 既定の flexGrow/flexShrink: 1 だと
      // 兄弟の FlatList に押されてチップ行が潰れる（#371）。
      await render(<WatchHistorySection />);
      expect(screen.getByTestId("watch-history-sort-row")).toHaveStyle({
        flexGrow: 0,
        flexShrink: 0,
      });
    });

    it("絞り込みシートで視聴状態を選ぶと該当作品だけになる", async () => {
      await render(<WatchHistorySection />);

      await fireEvent.press(screen.getByTestId("watch-history-filter-button"));
      expect(screen.getByTestId("watch-history-filter-sheet")).toBeTruthy();

      await fireEvent.press(screen.getByLabelText("視聴中で絞り込む"));
      expect(renderedOrder()).toEqual(["2"]);

      // 絞り込み中は 絞り込み後 / 全件 の件数を出す。
      expect(screen.getByText("1 / 3 件")).toBeTruthy();

      // リセットで全件に戻る。
      await fireEvent.press(screen.getByLabelText("絞り込みをリセット"));
      expect(renderedOrder()).toEqual(["1", "2", "3"]);
    });

    it("絞り込みシートで放送年代を選ぶと該当年代だけになる", async () => {
      await render(<WatchHistorySection />);

      await fireEvent.press(screen.getByTestId("watch-history-filter-button"));
      await fireEvent.press(screen.getByLabelText("2020年代で絞り込む"));

      expect(renderedOrder()).toEqual(["2", "3"]);
    });

    it("絞り込み結果が 0 件のときは条件不一致のメッセージを出し、履歴なし案内は出さない", async () => {
      await render(<WatchHistorySection />);

      await fireEvent.press(screen.getByTestId("watch-history-filter-button"));
      // フィクスチャに存在しない状態「断念」で 0 件にする。
      await fireEvent.press(screen.getByLabelText("断念で絞り込む"));

      expect(screen.queryAllByTestId(/^watch-history-item-\d+$/)).toHaveLength(
        0,
      );
      expect(
        screen.getByText("絞り込み条件に一致する履歴がありません。"),
      ).toBeTruthy();
      expect(screen.queryByText(/アニメ一覧から追加してください/)).toBeNull();
    });
  });
});
