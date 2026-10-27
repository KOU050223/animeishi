// dアニメインポート レビュー画面のテスト。
// ネイティブでは featureFlags.danimeImport が無効（#158）のため、
// 直接遷移されても視聴履歴タブへリダイレクトされることを検証する。
import React from "react";
import { act, render, renderHook } from "@testing-library/react-native";
import DanimeImportReviewScreen, {
  useElapsedSeconds,
} from "@/app/danime-import-review";

const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

jest.mock("@/lib/danime/useDanimeImport", () => ({
  useDanimeMatch: () => ({
    isPending: false,
    mutate: jest.fn(),
    reset: jest.fn(),
  }),
  useBulkRegisterWatchHistory: () => ({
    isPending: false,
    isError: false,
    mutate: jest.fn(),
    error: null,
  }),
}));

jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({ data: [], isLoading: false }),
  WATCH_STATUS_LABELS: {},
}));

jest.mock("@/components/anime-list/WorkThumbnail", () => ({
  WorkThumbnail: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DanimeImportReviewScreen（ネイティブ・フラグ無効）", () => {
  it("/(tabs)/watch-history へリダイレクトする", () => {
    render(<DanimeImportReviewScreen />);

    expect(mockRedirect).toHaveBeenCalledWith("/(tabs)/watch-history");
  });
});

// active の立ち上がりでの秒数リセットは effect ではなく
// レンダー中の状態調整で行う（#267）
describe("useElapsedSeconds", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("active の間だけ 0.5 秒刻みで経過秒数を返し、非活性化で止まる", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useElapsedSeconds(active),
      { initialProps: { active: false } },
    );
    expect(result.current).toBe(0);

    rerender({ active: true });
    act(() => jest.advanceTimersByTime(1600));
    expect(result.current).toBe(1);

    rerender({ active: false });
    const stopped = result.current;
    act(() => jest.advanceTimersByTime(3000));
    expect(result.current).toBe(stopped);
  });

  it("active の再立ち上がりで秒数を 0 に戻す", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useElapsedSeconds(active),
      { initialProps: { active: true } },
    );
    act(() => jest.advanceTimersByTime(2100));
    expect(result.current).toBe(2);

    rerender({ active: false });
    rerender({ active: true });

    expect(result.current).toBe(0);
  });
});
