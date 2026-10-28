// 視聴履歴画面のテスト。
// dアニメ取り込み導線は featureFlags.danimeImport で制御する（#158）:
// 無効（ネイティブ既定）ではボタンを出さず、有効（Web 版）では従来通り出す。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import WatchHistoryScreen from "@/app/(tabs)/watch-history";
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
jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({
    data: [{ annictWorkId: 1, title: "テスト作品", state: "WATCHED" }],
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

jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => ({ isConnected: true, isLoading: false }),
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockDanimeImport = false;
  mockUpsertMutateAsync.mockReset();
  mockRemoveMutateAsync.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockUpsertMutateAsync.mockResolvedValue({});
  mockRemoveMutateAsync.mockResolvedValue(null);
});

describe("WatchHistoryScreen", () => {
  it("フラグ無効（ネイティブ）では dアニメ取り込み導線を表示しない", async () => {
    await render(<WatchHistoryScreen />);

    expect(screen.getByText("視聴履歴")).toBeTruthy();
    expect(screen.queryByTestId("danime-import-button")).toBeNull();
  });

  it("フラグ有効（Web 版）では導線を表示し取り込み画面へ遷移する", async () => {
    mockDanimeImport = true;
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByTestId("danime-import-button"));

    expect(mockPush).toHaveBeenCalledWith("/danime-import");
  });

  it("保存を押すと API 応答を待たずモーダルが閉じて mutateAsync が呼ばれる", async () => {
    // API 応答が帰らない状態を再現するため pending のままにする。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("視聴中"));
    await fireEvent.press(screen.getByLabelText("保存"));

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      annictWorkId: 1,
      data: { state: "WATCHING" },
    });
    // 楽観更新前提のためモーダルは即座に閉じる。
    expect(screen.queryByText("視聴ステータスを編集")).toBeNull();
  });

  it("前回の更新が pending 中でも次の保存を発行できる", async () => {
    // 楽観更新は連続編集を許容する設計のため、pending 中の保存を無効化
    // しない（item 単位ロールバック＋スコープ直列化で整合性を保つ）。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
    // 1 回目が pending のまま再編集して保存できる。
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));

    expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("更新に失敗したらロールバックを知らせるダイアログを出す", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));

    // OK を押すまで消えないダイアログで「元の状態に戻した」ことまで伝える。
    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "更新できませんでした",
        "視聴ステータスを更新できませんでした。元の状態に戻しました。",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockUpsertMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));
    expect(mockAlert.mock.calls[0][1]).not.toContain("Network request failed");
  });

  it("表示中に起きた同種の失敗は閉じたあと件数でまとめて通知する", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    await render(<WatchHistoryScreen />);

    // 1回目の失敗でダイアログが出る（mock は onClose を呼ばないので開いたまま）。
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));

    // 表示中に同じ種類の失敗が重なっても、都度ダイアログは出さずキューに積む。
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
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
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));

    // ユーザーが OK で閉じる（onClose 発火）と次の失敗でまた出る。
    const options = mockAlert.mock.calls[0][2] as { onClose?: () => void };
    options.onClose?.();

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(2));
  });

  it("表示中の別種の失敗も捨てずに閉じたあと通知する", async () => {
    mockUpsertMutateAsync.mockRejectedValue(rejectedUpsertError(true));
    mockRemoveMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "視聴履歴の削除に失敗しました"),
    );
    await render(<WatchHistoryScreen />);

    // 更新失敗のダイアログが開く（mock は onClose を呼ばないので開いたまま）。
    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));
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
    await render(<WatchHistoryScreen />);

    await fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    await fireEvent.press(screen.getByLabelText("保存"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "更新できませんでした",
        "一部の更新に失敗しました。",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });
});
