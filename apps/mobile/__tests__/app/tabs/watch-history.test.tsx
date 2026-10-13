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

jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({
    data: [{ annictWorkId: 1, title: "テスト作品", state: "WATCHED" }],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpsertWatchHistory: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteWatchHistory: () => ({ mutate: jest.fn() }),
  WATCH_STATUS_LABELS: { WATCHED: "見た" },
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
});
