// ライブラリタブのテスト（issue #170）。
// アニメ / 視聴履歴 / 推し を上部セグメントで切り替え、
// 旧パスからのリダイレクト（?section=...）でも対応セクションを開く。
import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import LibraryScreen from "@/app/(tabs)/library/index";
import { colors } from "@/lib/theme/colors";

// useLocalSearchParams の値はテストごとに差し替える。
// setParams は実際はナビゲーション状態を更新して再描画するため、
// モックでは params の差し替えまで行い、再描画は rerender で再現する。
let mockParams: {
  section?: string;
  q?: string;
  season?: string;
  nav?: string;
} = {};
const mockSetParams = jest.fn((p: Record<string, string>) => {
  mockParams = { ...mockParams, ...p };
});
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 96,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams }),
}));

// セクション中身は別テストで担保するため、表示識別だけのスタブにする。
// issue #535: ?q=&season=&nav= が AnimeSection に渡るかだけはここで見る。
const mockAnimeSectionCalls: {
  initialQuery?: string;
  initialSeason?: string;
  navNonce?: string;
}[] = [];
jest.mock("@/components/library/AnimeSection", () => ({
  AnimeSection: (props: {
    initialQuery?: string;
    initialSeason?: string;
    navNonce?: string;
  }) => {
    mockAnimeSectionCalls.push(props);
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-anime" });
  },
}));
jest.mock("@/components/library/WatchHistorySection", () => ({
  WatchHistorySection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-history" });
  },
}));
jest.mock("@/components/library/FavoritesSection", () => ({
  FavoritesSection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-favorites" });
  },
}));

beforeEach(() => {
  mockParams = {};
  mockAnimeSectionCalls.length = 0;
  mockSetParams.mockClear();
  Object.defineProperty(Platform, "OS", { value: "ios" });
});

describe("LibraryScreen", () => {
  it("初期表示はアニメセクション", async () => {
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-anime")).toBeTruthy();
    expect(screen.queryByTestId("section-history")).toBeNull();
    expect(screen.queryByTestId("section-favorites")).toBeNull();
  });

  it("セグメント操作は URL の section を更新して切り替わる", async () => {
    const { rerender } = await render(<LibraryScreen />);

    await fireEvent.press(screen.getByTestId("library-section-history"));
    expect(mockSetParams).toHaveBeenCalledWith({ section: "history" });
    await rerender(<LibraryScreen />);
    expect(screen.getByTestId("section-history")).toBeTruthy();
    expect(screen.queryByTestId("section-anime")).toBeNull();

    await fireEvent.press(screen.getByTestId("library-section-favorites"));
    expect(mockSetParams).toHaveBeenCalledWith({ section: "favorites" });
    await rerender(<LibraryScreen />);
    expect(screen.getByTestId("section-favorites")).toBeTruthy();
    expect(screen.queryByTestId("section-history")).toBeNull();
  });

  it("?section=history で視聴履歴セクションを開く", async () => {
    mockParams = { section: "history" };
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-history")).toBeTruthy();
  });

  it("?section=favorites で推しセクションを開く", async () => {
    mockParams = { section: "favorites" };
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-favorites")).toBeTruthy();
  });

  it("未知の section 値は無視してアニメセクションを開く", async () => {
    mockParams = { section: "unknown" };
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-anime")).toBeTruthy();
  });

  it("?season=&nav= で開くと AnimeSection にシーズンと再マウント用の nonce を渡す（issue #535）", async () => {
    mockParams = { section: "anime", season: "2025-winter", nav: "123" };
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-anime")).toBeTruthy();
    expect(mockAnimeSectionCalls.at(-1)).toEqual({
      initialQuery: undefined,
      initialSeason: "2025-winter",
      navNonce: "123",
    });
  });

  // ネイティブヘッダーと背景色が食い違わないよう、セクションによらず
  // テーマの標準背景色を敷く（issue #469）。
  it.each(["anime", "history", "favorites"] as const)(
    "背景色はセクションによらずテーマの標準背景色（section=%s）",
    async (section) => {
      mockParams = { section };
      await render(<LibraryScreen />);

      expect(screen.getByTestId("library-screen")).toHaveStyle({
        backgroundColor: colors.light.background,
      });
    },
  );

  // iOS の透過ネイティブヘッダーはコンテンツが下に潜り込むため、
  // セグメント切り替えはヘッダー高さ分だけ下げる。
  it("透過ヘッダー分の上端余白を取る（iOS）", async () => {
    await render(<LibraryScreen />);

    expect(screen.getByTestId("library-screen")).toHaveStyle({
      paddingTop: 96,
    });
  });

  // Android はヘッダーが不透明でコンテンツがバー下から始まるため、
  // iOS と同じ余白を取るとヘッダー下に空白ができる（issue #469）。
  it("不透明ヘッダーの Android では上端余白を取らない", async () => {
    Object.defineProperty(Platform, "OS", { value: "android" });
    await render(<LibraryScreen />);

    expect(screen.getByTestId("library-screen")).toHaveStyle({
      paddingTop: 0,
    });
  });
});
