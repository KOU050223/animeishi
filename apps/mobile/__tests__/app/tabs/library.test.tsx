// ライブラリタブのテスト（issue #170）。
// アニメ / 視聴履歴 / 推し を上部セグメントで切り替え、
// 旧パスからのリダイレクト（?section=...）でも対応セクションを開く。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import LibraryScreen from "@/app/(tabs)/library";

// useLocalSearchParams の値はテストごとに差し替える。
let mockParams: { section?: string } = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
}));

// セクション中身は別テストで担保するため、表示識別だけのスタブにする。
jest.mock("@/components/library/AnimeSection", () => ({
  AnimeSection: () => {
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
});

describe("LibraryScreen", () => {
  it("初期表示はアニメセクション", async () => {
    await render(<LibraryScreen />);

    expect(screen.getByTestId("section-anime")).toBeTruthy();
    expect(screen.queryByTestId("section-history")).toBeNull();
    expect(screen.queryByTestId("section-favorites")).toBeNull();
  });

  it("セグメントで視聴履歴・推しへ切り替わる", async () => {
    await render(<LibraryScreen />);

    await fireEvent.press(screen.getByTestId("library-section-history"));
    expect(screen.getByTestId("section-history")).toBeTruthy();
    expect(screen.queryByTestId("section-anime")).toBeNull();

    await fireEvent.press(screen.getByTestId("library-section-favorites"));
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
});
