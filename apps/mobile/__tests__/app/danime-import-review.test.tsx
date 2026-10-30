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
import {
  DANIME_EXTRACT_SCHEMA_VERSION,
  type DanimeAnnictWork,
  type DanimeMatchItem,
} from "@animeishi/danime-core";

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

// 履歴取得結果はテストごとに差し替える（保護ステータスの検証で
// WATCHED 等を返したいため）。getter 遅延評価は mockFeatureFlags と同じ理由。
const mockHistories: {
  data: { annictWorkId: number; state: string }[] | undefined;
  isLoading: boolean;
} = { data: [], isLoading: false };
jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({
    data: mockHistories.data,
    isLoading: mockHistories.isLoading,
  }),
  WATCH_STATUS_LABELS: jest.requireActual("@/lib/watchStatusLabels")
    .WATCH_STATUS_LABELS,
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
  mockHistories.data = [];
  mockHistories.isLoading = false;
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

describe("DanimeImportReviewScreen（既存ステータスの保護）", () => {
  function annictWork(id: number): DanimeAnnictWork {
    return {
      annictWorkId: id,
      nodeId: `Work-${id}`,
      title: `Annict作品${id}`,
      titleKana: null,
      titleEn: null,
      seasonName: null,
      seasonYear: null,
      imageUrl: null,
      malAnimeId: null,
    };
  }

  function matchItem(
    danimeWorkId: string,
    title: string,
    workId: number,
    targetState: "WATCHED" | "WATCHING" = "WATCHING",
  ): DanimeMatchItem {
    return {
      danimeWorkId,
      title,
      targetState,
      status: "exact",
      work: annictWork(workId),
      candidates: [],
    };
  }

  function stubMatchSuccess(items: DanimeMatchItem[]) {
    mockUseDanimeMatch.mockReturnValue({
      isPending: false,
      error: null,
      mutate: (_args: unknown, opts?: { onSuccess?: (out: unknown) => void }) =>
        opts?.onSuccess?.({ items, elapsedMs: 0 }),
      reset: jest.fn(),
    });
  }

  beforeEach(() => {
    mockFeatureFlags.danimeImport = true;
    setStoreLists();
  });

  it("視聴済・一時停止・断念の作品は理由を表示して選択不可にする", async () => {
    mockHistories.data = [
      { annictWorkId: 1, state: "WATCHED" },
      { annictWorkId: 2, state: "ON_HOLD" },
      { annictWorkId: 3, state: "STOP_WATCHING" },
    ];
    stubMatchSuccess([
      matchItem("w1", "視聴済作品", 1),
      matchItem("w2", "一時停止作品", 2),
      matchItem("w3", "断念作品", 3),
      matchItem("w4", "新規作品", 4),
    ]);

    await render(<DanimeImportReviewScreen />);

    // 保護対象は理由が表示され、チェックボックスが無効化される。
    expect(
      screen.getByText("Annict で「視聴済」のため変更しません"),
    ).toBeTruthy();
    expect(
      screen.getByText("Annict で「一時停止」のため変更しません"),
    ).toBeTruthy();
    expect(
      screen.getByText("Annict で「断念」のため変更しません"),
    ).toBeTruthy();
    for (const title of ["視聴済作品", "一時停止作品", "断念作品"]) {
      const checkbox = screen.getByLabelText(`${title} を登録対象にする`);
      expect(checkbox.props.accessibilityState.disabled).toBe(true);
      expect(checkbox.props.accessibilityState.checked).toBe(false);
    }

    // 登録対象は新規作品だけ（3 件の保護作品は数えない）。
    expect(screen.getByText("1 件を Annict に登録")).toBeTruthy();
  });

  it("同じステータス登録済みは注記付きで既定オフ、視聴予定は登録対象にする", async () => {
    mockHistories.data = [
      { annictWorkId: 1, state: "WATCHING" },
      { annictWorkId: 2, state: "WANNA_WATCH" },
    ];
    stubMatchSuccess([
      matchItem("w1", "視聴中作品", 1),
      matchItem("w2", "視聴予定作品", 2),
    ]);

    await render(<DanimeImportReviewScreen />);

    expect(screen.getByText("Annict で「視聴中」登録済み")).toBeTruthy();
    // 視聴中→視聴中は変更の意味がないので既定オフだが選択はできる。
    const registeredCheckbox = screen.getByLabelText(
      "視聴中作品 を登録対象にする",
    );
    expect(registeredCheckbox.props.accessibilityState.checked).toBe(false);
    expect(registeredCheckbox.props.accessibilityState.disabled).toBeFalsy();
    // WANNA_WATCH → WATCHING は前進なので既定で登録対象。
    expect(
      screen.getByLabelText("視聴予定作品 を登録対象にする").props
        .accessibilityState.checked,
    ).toBe(true);
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
