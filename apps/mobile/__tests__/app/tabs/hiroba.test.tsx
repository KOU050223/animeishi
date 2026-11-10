// ひろばタブのテスト（issue #352 / #422）。
// 「つくる / みつける」セグメントでセクションが切り替わることを確かめる。
import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import HirobaScreen from "@/app/(tabs)/hiroba/index";

// useHeaderHeight はナビゲーションコンテキスト外では値を返せないため固定値にする。
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 96,
}));

// セクション中身は別テストで担保するため、表示識別だけのスタブにする。
jest.mock("@/components/hiroba/CreateSection", () => ({
  CreateSection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-create" });
  },
}));
jest.mock("@/components/hiroba/DiscoverSection", () => ({
  DiscoverSection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-discover" });
  },
}));

beforeEach(() => {
  Object.defineProperty(Platform, "OS", { value: "ios" });
});

describe("HirobaScreen", () => {
  it("初期表示はつくるセクション", async () => {
    await render(<HirobaScreen />);

    expect(screen.getByTestId("section-create")).toBeTruthy();
    expect(screen.queryByTestId("section-discover")).toBeNull();
  });

  it("みつけるセグメントで公開一覧セクションに切り替わる", async () => {
    await render(<HirobaScreen />);

    await fireEvent.press(screen.getByTestId("hiroba-section-discover"));
    expect(screen.getByTestId("section-discover")).toBeTruthy();
    expect(screen.queryByTestId("section-create")).toBeNull();

    await fireEvent.press(screen.getByTestId("hiroba-section-create"));
    expect(screen.getByTestId("section-create")).toBeTruthy();
  });

  // iOS の透過ネイティブヘッダーはコンテンツが下に潜り込むため、
  // セグメント切り替えはヘッダー高さ分だけ下げる。
  it("透過ヘッダー分の上端余白を取る（iOS）", async () => {
    await render(<HirobaScreen />);

    expect(screen.getByTestId("hiroba-screen")).toHaveStyle({
      paddingTop: 96,
    });
  });

  // Android はヘッダーが不透明でコンテンツがバー下から始まるため、
  // iOS と同じ余白を取るとヘッダー下に空白ができる（issue #491）。
  it("不透明ヘッダーの Android では上端余白を取らない", async () => {
    Object.defineProperty(Platform, "OS", { value: "android" });
    await render(<HirobaScreen />);

    expect(screen.getByTestId("hiroba-screen")).toHaveStyle({
      paddingTop: 0,
    });
  });
});
