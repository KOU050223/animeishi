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

beforeEach(async () => {
  jest.clearAllMocks();
});

describe("DanimeImportReviewScreen（ネイティブ・フラグ無効）", () => {
  it("/(tabs)/library?section=history へリダイレクトする", async () => {
    await render(<DanimeImportReviewScreen />);

    expect(mockRedirect).toHaveBeenCalledWith(
      "/(tabs)/library?section=history",
    );
  });
});

// active の立ち上がりでの秒数リセットは effect ではなく
// レンダー中の状態調整で行う（#267）
describe("useElapsedSeconds", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
  });
  afterEach(async () => {
    jest.useRealTimers();
  });

  it("active の間だけ 0.5 秒刻みで経過秒数を返し、非活性化で止まる", async () => {
    const { result, rerender } = await renderHook(
      ({ active }: { active: boolean }) => useElapsedSeconds(active),
      { initialProps: { active: false } },
    );
    expect(result.current).toBe(0);

    await rerender({ active: true });
    await act(() => jest.advanceTimersByTime(1600));
    expect(result.current).toBe(1);

    await rerender({ active: false });
    const stopped = result.current;
    await act(() => jest.advanceTimersByTime(3000));
    expect(result.current).toBe(stopped);
  });

  it("active の再立ち上がりで秒数を 0 に戻す", async () => {
    const { result, rerender } = await renderHook(
      ({ active }: { active: boolean }) => useElapsedSeconds(active),
      { initialProps: { active: true } },
    );
    await act(() => jest.advanceTimersByTime(2100));
    expect(result.current).toBe(2);

    await rerender({ active: false });
    await rerender({ active: true });

    expect(result.current).toBe(0);
  });
});
