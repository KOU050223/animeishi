// 視聴履歴画面のテスト。
// dアニメ取り込み導線は featureFlags.danimeImport で制御する（#158）:
// 無効（ネイティブ既定）ではボタンを出さず、有効（Web 版）では従来通り出す。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
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

// upsert.mutateAsync の振る舞いをテストごとに差し替えられるよう遅延参照する。
const mockUpsertMutateAsync = jest.fn();
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
  useDeleteWatchHistory: () => ({ mutate: jest.fn() }),
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

jest.mock("@/lib/dialog", () => ({ confirm: jest.fn() }));
jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: () => null,
}));
jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockDanimeImport = false;
  mockUpsertMutateAsync.mockReset();
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockUpsertMutateAsync.mockResolvedValue({});
});

describe("WatchHistoryScreen", () => {
  it("フラグ無効（ネイティブ）では dアニメ取り込み導線を表示しない", () => {
    render(<WatchHistoryScreen />);

    expect(screen.getByText("視聴履歴")).toBeTruthy();
    expect(screen.queryByTestId("danime-import-button")).toBeNull();
  });

  it("フラグ有効（Web 版）では導線を表示し取り込み画面へ遷移する", () => {
    mockDanimeImport = true;
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByTestId("danime-import-button"));

    expect(mockPush).toHaveBeenCalledWith("/danime-import");
  });

  it("保存を押すと API 応答を待たずモーダルが閉じて mutateAsync が呼ばれる", () => {
    // API 応答が帰らない状態を再現するため pending のままにする。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("視聴中"));
    fireEvent.press(screen.getByLabelText("保存"));

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      annictWorkId: 1,
      data: { state: "WATCHING" },
    });
    // 楽観更新前提のためモーダルは即座に閉じる。
    expect(screen.queryByText("視聴ステータスを編集")).toBeNull();
  });

  it("前回の更新が pending 中でも次の保存を発行できる", () => {
    // 楽観更新は連続編集を許容する設計のため、pending 中の保存を無効化
    // しない（item 単位ロールバック＋スコープ直列化で整合性を保つ）。
    mockUpsertMutateAsync.mockReturnValue(new Promise(() => {}));
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("保存"));
    // 1 回目が pending のまま再編集して保存できる。
    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("保存"));

    expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("更新に失敗したらロールバックを知らせるエラートーストを出す", async () => {
    mockUpsertMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "視聴履歴の更新に失敗しました"),
    );
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("保存"));

    await screen.findByText("視聴履歴の更新に失敗しました");
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockUpsertMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("保存"));

    await screen.findByText("視聴履歴の更新に失敗しました");
    expect(screen.queryByText("Network request failed")).toBeNull();
  });
});
