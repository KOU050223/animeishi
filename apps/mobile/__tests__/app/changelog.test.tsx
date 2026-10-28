import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import ChangelogScreen from "@/app/changelog";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
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
    expect(
      screen.getByText("シーズンごとのアニメ Tier 表を追加しました"),
    ).toBeTruthy();
    expect(screen.getByText("ダークモード対応")).toBeTruthy();
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

    await fireEvent.press(screen.getByTestId("planned-feature-171"));

    expect(openURL).toHaveBeenCalledWith(
      "https://github.com/KOU050223/animeishi/issues/171",
    );
  });
});
