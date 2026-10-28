import React from "react";
import { render, screen } from "@testing-library/react-native";
import TermsScreen from "@/app/terms";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    replace: jest.fn(),
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

describe("TermsScreen", () => {
  it("タイトルと主要なセクションを表示する", async () => {
    await render(<TermsScreen />);

    // タイトルとフッターリンクの 2 箇所に出るため複数ヒットを許容する。
    expect(screen.getAllByText("利用規約").length).toBeGreaterThan(0);
    expect(screen.getByText("第3条（禁止事項）")).toBeTruthy();
    expect(
      screen.getByText("第4条（ユーザーコンテンツと公開範囲）"),
    ).toBeTruthy();
    expect(screen.getByText("第10条（準拠法・管轄）")).toBeTruthy();
  });

  it("プライバシーポリシーページへのリンクを表示する", async () => {
    await render(<TermsScreen />);

    expect(screen.getByTestId("legal-privacy-link")).toBeTruthy();
    expect(screen.getByTestId("legal-terms-link")).toBeTruthy();
  });
});
