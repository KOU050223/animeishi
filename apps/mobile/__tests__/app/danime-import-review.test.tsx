// dアニメインポート レビュー画面のテスト。
// ネイティブでは featureFlags.danimeImport が無効（#158）のため、
// 直接遷移されても視聴履歴タブへリダイレクトされることを検証する。
import React from "react";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import DanimeImportReviewScreen, {
  useElapsedSeconds,
} from "@/app/danime-import-review";
import { ApiRequestError } from "@/lib/apiError";
import { useDanimeImportStore } from "@/store/danimeImportStore";
import { DANIME_EXTRACT_SCHEMA_VERSION } from "@animeishi/danime-core";

const mockRedirect = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

// フラグはテストごとに切り替える（jest.mock は iOS プラットフォームで解決
// されるため、フラグ無効と有効の両方を同じファイルで検証する）。
// getter で遅延評価するのは、jest.mock の巻き上げでファクトリが
// mockFeatureFlags の初期化より先に走るため。
const mockFeatureFlags = { danimeImport: false };
jest.mock("@/lib/featureFlags", () => ({
  featureFlags: {
    get danimeImport() {
      return mockFeatureFlags.danimeImport;
    },
  },
}));

const mockUseDanimeMatch = jest.fn();
jest.mock("@/lib/danime/useDanimeImport", () => ({
  useDanimeMatch: () => mockUseDanimeMatch(),
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

function setStoreLists() {
  useDanimeImportStore.getState().setLists({
    schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION,
    completed: [],
    history: [{ workId: "w1", title: "作品1", partIds: ["p1"] }],
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockFeatureFlags.danimeImport = false;
  mockUseDanimeMatch.mockReturnValue({
    isPending: false,
    error: null,
    mutate: jest.fn(),
    reset: jest.fn(),
  });
  useDanimeImportStore.getState().setLists(null);
});

describe("DanimeImportReviewScreen（ネイティブ・フラグ無効）", () => {
  it("/(tabs)/library?section=history へリダイレクトする", async () => {
    await render(<DanimeImportReviewScreen />);

    expect(mockRedirect).toHaveBeenCalledWith(
      "/(tabs)/library?section=history",
    );
  });
});

describe("DanimeImportReviewScreen（照合失敗）", () => {
  it("API のエラー JSON ではなく code 別のユーザー文言を出し、戻るボタンを表示する", async () => {
    mockFeatureFlags.danimeImport = true;
    mockUseDanimeMatch.mockReturnValue({
      isPending: false,
      error: new ApiRequestError(
        502,
        "Annict とのマッチングに失敗しました（HTTP 502）",
        "annict_upstream",
      ),
      mutate: jest.fn(),
      reset: jest.fn(),
    });
    setStoreLists();

    await render(<DanimeImportReviewScreen />);

    expect(
      screen.getByText(
        "Annict との通信に失敗しました。時間をおいて再度お試しください。",
      ),
    ).toBeTruthy();
    // エラー JSON や内部メッセージは画面に出さない
    expect(screen.queryByText(/HTTP 502/)).toBeNull();
    // 戻る導線は左上のヘッダー位置の BackButton
    expect(screen.getByLabelText("戻る")).toBeTruthy();
    expect(screen.getByLabelText("再試行")).toBeTruthy();
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
