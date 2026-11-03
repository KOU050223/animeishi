// ひろばタブのテスト（issue #352 / #422）。
// 「つくる / みつける」セグメントでセクションが切り替わることを確かめる。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import HirobaScreen from "@/app/(tabs)/hiroba/index";

jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 0,
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
});
