// dアニメインポート レビュー画面のテスト。
// ネイティブでは featureFlags.danimeImport が無効（#158）のため、
// 直接遷移されても視聴履歴タブへリダイレクトされることを検証する。
import React from "react";
import { render } from "@testing-library/react-native";
import DanimeImportReviewScreen from "@/app/danime-import-review";

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
