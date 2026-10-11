import React from "react";
import { render, screen } from "@testing-library/react-native";
import PrivacyScreen from "@/app/privacy";

jest.mock("expo-router", () => ({
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

describe("PrivacyScreen", () => {
  it("タイトルと主要なセクションを表示する", () => {
    render(<PrivacyScreen />);

    // タイトルとフッターリンクの 2 箇所に出るため複数ヒットを許容する。
    expect(screen.getAllByText("プライバシーポリシー").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("第2条（取得する情報）")).toBeTruthy();
    expect(screen.getByText("第4条（外部サービスへの送信）")).toBeTruthy();
    expect(screen.getByText("第7条（アカウントの削除）")).toBeTruthy();
  });

  it("実装で実際に利用している外部サービスを列挙する", () => {
    render(<PrivacyScreen />);

    // コード調査に基づく外部送信先。未実装のサービス（例: Gemini）は書かない。
    expect(screen.getByText(/Clerk（認証）/)).toBeTruthy();
    expect(screen.getByText(/Annict（視聴記録連携）/)).toBeTruthy();
    expect(screen.getByText(/AniList・Jikan/)).toBeTruthy();
    expect(screen.getByText(/Sentry（エラー監視）/)).toBeTruthy();
    expect(screen.getByText(/Cloudflare（ホスティング）/)).toBeTruthy();
  });

  it("アカウント削除の手順を案内する", () => {
    render(<PrivacyScreen />);

    expect(
      screen.getByText(/プロフィール画面の「アカウントを削除」から行えます/),
    ).toBeTruthy();
  });

  it("利用規約ページへのリンクを表示する", () => {
    render(<PrivacyScreen />);

    expect(screen.getByTestId("legal-terms-link")).toBeTruthy();
    expect(screen.getByTestId("legal-privacy-link")).toBeTruthy();
  });
});
