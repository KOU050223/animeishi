import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import ChangelogScreen from "@/app/changelog";

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
}));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockCanGoBack = true;
});

describe("ChangelogScreen", () => {
  it("タイトルと 3 つのセクションを表示する", async () => {
    await render(<ChangelogScreen />);

    expect(screen.getByText("機能一覧・更新情報")).toBeTruthy();
    expect(screen.getByText("このアプリでできること")).toBeTruthy();
    expect(screen.getByText("更新情報")).toBeTruthy();
    expect(screen.getByText("今後追加したい機能")).toBeTruthy();
  });

  it("静的データ（機能・更新・予定）の各項目を表示する", async () => {
    await render(<ChangelogScreen />);

    expect(screen.getByText("アニメ名刺の作成")).toBeTruthy();
    expect(screen.getByText("シーズン Tier 表")).toBeTruthy();
    expect(screen.getByText("キャラクター・自由テーマの Tier 表")).toBeTruthy();
    expect(
      screen.getByText("シーズンごとのアニメ Tier 表を追加しました"),
    ).toBeTruthy();
    expect(screen.getByText("ダークモード")).toBeTruthy();
    // 「今後追加したい機能」には open issue だけを並べる運用。
    // 実装済み（closed）の機能が残っていないことを代表例で確認する。
    expect(screen.queryByText("キャラクターの Tier 表")).toBeNull();
    expect(screen.getByText("どの画面からも作品詳細を開く")).toBeTruthy();
  });

  it("フラグで隠した総選挙・イベント・特集記事は「できること」に載せない（#750）", async () => {
    await render(<ChangelogScreen />);

    expect(screen.queryByText("イベント・総選挙・特集記事")).toBeNull();
  });

  it("遷移履歴がある場合、戻るボタンで前の画面へ戻る", async () => {
    await render(<ChangelogScreen />);

    await fireEvent.press(screen.getByTestId("changelog-back-button"));

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("遷移履歴が無い場合、戻るボタンでホームへ戻る", async () => {
    mockCanGoBack = false;
    await render(<ChangelogScreen />);

    await fireEvent.press(screen.getByTestId("changelog-back-button"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("予定機能のチップをタップすると対応する GitHub issue を開く", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(<ChangelogScreen />);

    await fireEvent.press(screen.getByTestId("planned-feature-628"));

    expect(openURL).toHaveBeenCalledWith(
      "https://github.com/KOU050223/animeishi/issues/628",
    );
  });
});
