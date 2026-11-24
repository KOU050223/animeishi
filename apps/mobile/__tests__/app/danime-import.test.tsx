// dアニメ取り込み画面（ネイティブ）のテスト。
// jest-expo は iOS プラットフォームで解決するため @/app/danime-import は
// danime-import.native.tsx に解決される。#751 でネイティブでも既定有効に
// なったため、有効時の WebView UI・遷移先制限と、フラグ無効時
// （env 切り戻し・停止スイッチ）の Web 版案内の両方を検証する。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import DanimeImportScreen from "@/app/danime-import";

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

// フラグはテストごとに切り替える（jest.mock は iOS プラットフォームで解決
// されるため、フラグ有効と無効の両方を同じファイルで検証する）。
// getter で遅延評価するのは、jest.mock の巻き上げでファクトリが
// mockFeatureFlags の初期化より先に走るため。
const mockFeatureFlags = { danimeImport: true };
jest.mock("@/lib/featureFlags", () => ({
  featureFlags: {
    get danimeImport() {
      return mockFeatureFlags.danimeImport;
    },
  },
}));

// WebView は props を退避するスタブにして、遷移先制限のハンドラを
// テストから直接呼べるようにする。
let webViewProps: {
  onShouldStartLoadWithRequest?: (request: {
    url: string;
    isTopFrame: boolean;
  }) => boolean;
} = {};
jest.mock("react-native-webview", () => ({
  WebView: (props: Record<string, unknown>) => {
    webViewProps = props;
    return null;
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockFeatureFlags.danimeImport = true;
  webViewProps = {};
});

describe("DanimeImportScreen（ネイティブ・フラグ有効）", () => {
  it("WebView の案内と読み取りボタンを表示する", async () => {
    await render(<DanimeImportScreen />);

    expect(screen.getByTestId("danime-extract-button")).toBeTruthy();
    expect(screen.getByLabelText("戻る")).toBeTruthy();
    expect(screen.queryByTestId("danime-open-web-button")).toBeNull();
  });

  it("dアニメストアと dアカウント認証への遷移は WebView 内で許可する", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve());
    await render(<DanimeImportScreen />);
    const shouldStart = webViewProps.onShouldStartLoadWithRequest;
    expect(shouldStart).toBeDefined();

    expect(
      shouldStart?.({
        url: "https://animestore.docomo.ne.jp/animestore/ci?workId=99999",
        isTopFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldStart?.({
        url: "https://id.smt.docomo.ne.jp/cgi8/touchtown/oidc/authorizactn?client_id=x",
        isTopFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldStart?.({
        url: "https://cfg.smt.docomo.ne.jp/authx/cgi/baseauth?clientid=x",
        isTopFrame: true,
      }),
    ).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("許可外ドメインへのトップレベル遷移は外部ブラウザで開く", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve());
    await render(<DanimeImportScreen />);
    const shouldStart = webViewProps.onShouldStartLoadWithRequest;

    expect(
      shouldStart?.({ url: "https://example.com/", isTopFrame: true }),
    ).toBe(false);
    expect(openURL).toHaveBeenCalledWith("https://example.com/");
  });

  it("iframe などのサブフレーム遷移は外部ブラウザを開かずブロックする", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve());
    await render(<DanimeImportScreen />);
    const shouldStart = webViewProps.onShouldStartLoadWithRequest;

    expect(
      shouldStart?.({ url: "https://example.com/ad", isTopFrame: false }),
    ).toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });
});

describe("DanimeImportScreen（ネイティブ・フラグ無効）", () => {
  beforeEach(() => {
    mockFeatureFlags.danimeImport = false;
  });

  it("Web 版への案内を表示し、取り込み UI は出さない", async () => {
    await render(<DanimeImportScreen />);

    expect(
      screen.getByText("この機能は現在 Web 版でのみ利用できます。"),
    ).toBeTruthy();
    expect(screen.getByTestId("danime-open-web-button")).toBeTruthy();
    expect(screen.queryByTestId("danime-extract-button")).toBeNull();
  });

  it("「Web 版を開く」で Web 版の取り込み画面を外部ブラウザで開く", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve());
    await render(<DanimeImportScreen />);

    await fireEvent.press(screen.getByTestId("danime-open-web-button"));

    expect(openURL).toHaveBeenCalledWith(
      expect.stringMatching(/\/danime-import$/),
    );
  });

  it("「戻る」で前の画面へ戻る", async () => {
    await render(<DanimeImportScreen />);

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
