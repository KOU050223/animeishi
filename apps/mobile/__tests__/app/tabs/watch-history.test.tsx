// 視聴履歴画面のテスト。
// dアニメ取り込み導線は featureFlags.danimeImport で制御する（#158）:
// 無効（ネイティブ既定）ではボタンを出さず、有効（Web 版）では従来通り出す。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import WatchHistoryScreen from "@/app/(tabs)/watch-history";

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

// upsert.mutate の振る舞いをテストごとに差し替えられるよう遅延参照する。
const mockUpsertMutate = jest.fn();
jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({
    data: [{ annictWorkId: 1, title: "テスト作品", state: "WATCHED" }],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpsertWatchHistory: () => ({
    mutate: (...args: unknown[]) => mockUpsertMutate(...args),
    isPending: false,
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
  mockUpsertMutate.mockReset();
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

  it("保存を押すと API 応答を待たずモーダルが閉じて mutate が呼ばれる", () => {
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("視聴中"));
    fireEvent.press(screen.getByLabelText("保存"));

    expect(mockUpsertMutate).toHaveBeenCalledWith(
      { annictWorkId: 1, data: { state: "WATCHING" } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    // 楽観更新前提のためモーダルは即座に閉じる。
    expect(screen.queryByText("視聴ステータスを編集")).toBeNull();
  });

  it("更新に失敗したらロールバックを知らせるエラートーストを出す", () => {
    mockUpsertMutate.mockImplementation(
      (_vars: unknown, options: { onError: (e: Error) => void }) =>
        options.onError(new Error("視聴履歴の更新に失敗しました")),
    );
    render(<WatchHistoryScreen />);

    fireEvent.press(screen.getByLabelText("テスト作品 の視聴履歴を編集"));
    fireEvent.press(screen.getByLabelText("保存"));

    expect(screen.getByText("視聴履歴の更新に失敗しました")).toBeTruthy();
  });
});
