// QR・フレンドタブのテスト（issue #170）。
// QR / フレンド を上部セグメントで切り替え、
// 旧パスからのリダイレクト（?section=...）でも対応セクションを開く。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import SocialScreen from "@/app/(tabs)/social/index";

// useLocalSearchParams の値はテストごとに差し替える。
// setParams は実際はナビゲーション状態を更新して再描画するため、
// モックでは params の差し替えまで行い、再描画は rerender で再現する。
let mockParams: { section?: string } = {};
const mockSetParams = jest.fn((p: Record<string, string>) => {
  mockParams = { ...mockParams, ...p };
});
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 0,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams }),
}));

// セクション中身は別テストで担保するため、表示識別だけのスタブにする。
jest.mock("@/components/social/QrSection", () => ({
  QrSection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-qr" });
  },
}));
jest.mock("@/components/social/FriendsSection", () => ({
  FriendsSection: () => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: "section-friends" });
  },
}));

beforeEach(() => {
  mockParams = {};
  mockSetParams.mockClear();
});

describe("SocialScreen", () => {
  it("初期表示は QR セクション", async () => {
    await render(<SocialScreen />);

    expect(screen.getByTestId("section-qr")).toBeTruthy();
    expect(screen.queryByTestId("section-friends")).toBeNull();
  });

  it("セグメント操作は URL の section を更新してフレンドへ切り替わる", async () => {
    const { rerender } = await render(<SocialScreen />);

    await fireEvent.press(screen.getByTestId("social-section-friends"));
    expect(mockSetParams).toHaveBeenCalledWith({ section: "friends" });
    await rerender(<SocialScreen />);

    expect(screen.getByTestId("section-friends")).toBeTruthy();
    expect(screen.queryByTestId("section-qr")).toBeNull();
  });

  it("?section=friends でフレンドセクションを開く", async () => {
    mockParams = { section: "friends" };
    await render(<SocialScreen />);

    expect(screen.getByTestId("section-friends")).toBeTruthy();
  });

  it("未知の section 値は無視して QR セクションを開く", async () => {
    mockParams = { section: "unknown" };
    await render(<SocialScreen />);

    expect(screen.getByTestId("section-qr")).toBeTruthy();
  });
});
