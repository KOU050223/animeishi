// dアニメ取り込み画面（ネイティブ）のテスト。
// jest-expo は iOS プラットフォームで解決するため @/app/danime-import は
// danime-import.native.tsx に解決され、featureFlags.danimeImport は
// 既定で無効（#158）。ディープリンク等で直接遷移された場合の案内を検証する。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import DanimeImportScreen from "@/app/danime-import";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
}));

// フラグ無効時は WebView を描画しないが、モジュール import 自体は残るため
// ネイティブモジュール依存をモックする。
jest.mock("react-native-webview", () => ({
  WebView: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DanimeImportScreen（ネイティブ・フラグ無効）", () => {
  it("Web 版への案内を表示し、取り込み UI は出さない", () => {
    render(<DanimeImportScreen />);

    expect(
      screen.getByText("この機能は現在 Web 版でのみ利用できます。"),
    ).toBeTruthy();
    expect(screen.getByTestId("danime-open-web-button")).toBeTruthy();
    expect(screen.queryByTestId("danime-extract-button")).toBeNull();
  });

  it("「Web 版を開く」で Web 版の取り込み画面を外部ブラウザで開く", () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve(true));
    render(<DanimeImportScreen />);

    fireEvent.press(screen.getByTestId("danime-open-web-button"));

    expect(openURL).toHaveBeenCalledWith(
      expect.stringMatching(/\/danime-import$/),
    );
  });

  it("「戻る」で前の画面へ戻る", () => {
    render(<DanimeImportScreen />);

    fireEvent.press(screen.getByText("戻る"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
