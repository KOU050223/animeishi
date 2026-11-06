import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import SupportScreen from "@/app/support";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画する。画面が headerLeft / title として
  // 渡したもの（戻るボタンの testID・画面タイトル）をテストできるようにする。
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
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

describe("SupportScreen", () => {
  it("タイトルと FAQ セクションを表示する", async () => {
    await render(<SupportScreen />);

    expect(screen.getByText("サポート")).toBeTruthy();
    expect(screen.getByText("Q. 視聴履歴や作品検索が使えません")).toBeTruthy();
    expect(screen.getByText("Q. 名刺を交換できません")).toBeTruthy();
    expect(
      screen.getByText("Q. dアニメストアの視聴履歴を取り込めません"),
    ).toBeTruthy();
  });

  it("問い合わせ先のプレースホルダと法務ページへのリンクを表示する", async () => {
    await render(<SupportScreen />);

    expect(screen.getByText(/{{CONTACT_EMAIL}}/)).toBeTruthy();
    expect(screen.getByTestId("legal-privacy-link")).toBeTruthy();
    expect(screen.getByTestId("legal-terms-link")).toBeTruthy();
  });

  it("遷移履歴が無い場合、戻るボタンでホームへ戻る", async () => {
    mockCanGoBack = false;
    await render(<SupportScreen />);

    await fireEvent.press(screen.getByTestId("legal-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
