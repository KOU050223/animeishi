import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import PrivacyScreen from "@/app/privacy";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
  }),
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const { Pressable } = require("react-native");
    return <Pressable {...props}>{children}</Pressable>;
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

describe("PrivacyScreen", () => {
  it("タイトルと主要なセクションを表示する", async () => {
    await render(<PrivacyScreen />);

    // タイトルとフッターリンクの 2 箇所に出るため複数ヒットを許容する。
    expect(screen.getAllByText("プライバシーポリシー").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("第2条（取得する情報）")).toBeTruthy();
    expect(screen.getByText("第4条（外部サービスへの送信）")).toBeTruthy();
    expect(screen.getByText("第7条（アカウントの削除）")).toBeTruthy();
  });

  it("実装で実際に利用している外部サービスを列挙する", async () => {
    await render(<PrivacyScreen />);

    // コード調査に基づく外部送信先。未実装のサービス（例: Gemini）は書かない。
    expect(screen.getByText(/Clerk（認証）/)).toBeTruthy();
    expect(screen.getByText(/Annict（視聴記録連携）/)).toBeTruthy();
    expect(screen.getByText(/AniList・Jikan/)).toBeTruthy();
    expect(screen.getByText(/Sentry（エラー監視）/)).toBeTruthy();
    expect(screen.getByText(/Cloudflare（ホスティング）/)).toBeTruthy();
  });

  it("アカウント削除の手順を案内する", async () => {
    await render(<PrivacyScreen />);

    expect(
      screen.getByText(/プロフィール画面の「アカウントを削除」から行えます/),
    ).toBeTruthy();
  });

  it("利用規約ページへのリンクを表示する", async () => {
    await render(<PrivacyScreen />);

    expect(screen.getByTestId("legal-terms-link")).toBeTruthy();
    expect(screen.getByTestId("legal-privacy-link")).toBeTruthy();
  });

  it("遷移履歴がある場合、戻るボタンで前の画面へ戻る", async () => {
    await render(<PrivacyScreen />);

    await fireEvent.press(screen.getByTestId("legal-back-button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("直リンク等で遷移履歴が無い場合、戻るボタンでホームへ戻る", async () => {
    mockCanGoBack = false;
    await render(<PrivacyScreen />);

    await fireEvent.press(screen.getByTestId("legal-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
