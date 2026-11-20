import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FriendThanksSheet } from "./FriendThanksSheet";

const mockOnClose = jest.fn();
const mockOnSubmit = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("FriendThanksSheet", () => {
  it("定型文を 1 つ選ぶまで送信ボタンは押せない（定型文は必須）", async () => {
    await render(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    // 4 つの定型文候補が出る
    expect(screen.getByText("名刺ありがとうございました！")).toBeTruthy();
    expect(screen.getByText("お話しできて楽しかったです")).toBeTruthy();
    expect(screen.getByText("また会いましょう")).toBeTruthy();
    expect(screen.getByText("今度おすすめ教えてください")).toBeTruthy();

    const sendButton = screen.getByTestId("thanks-send-button");
    expect(sendButton.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(sendButton);
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it("定型文を選んで送信するとキーが渡される（文言ではなくキーで送る）", async () => {
    await render(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId("thanks-preset-see_you_again"));
    await fireEvent.press(screen.getByTestId("thanks-send-button"));

    expect(mockOnSubmit).toHaveBeenCalledWith("see_you_again", null);
  });

  it("ひとことを入れて送信するとトリムした本文が渡される", async () => {
    await render(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId("thanks-preset-thanks_for_card"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("ひとこと添える（任意）"),
      "  楽しかったです  ",
    );
    await fireEvent.press(screen.getByTestId("thanks-send-button"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      "thanks_for_card",
      "楽しかったです",
    );
  });

  it("ひとことの入力は 60 文字まで（1 行・改行不可の任意入力）", async () => {
    await render(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    const input = screen.getByPlaceholderText("ひとこと添える（任意）");
    expect(input.props.maxLength).toBe(60);
    expect(input.props.multiline ?? false).toBe(false);
  });

  it("開き直すと前回の入力は残らない", async () => {
    const { rerender } = await render(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );
    await fireEvent.press(screen.getByTestId("thanks-preset-see_you_again"));

    await rerender(
      <FriendThanksSheet
        visible={false}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );
    await rerender(
      <FriendThanksSheet
        visible
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    // 前回選んだ定型文はリセットされ、送信ボタンは無効に戻る
    expect(
      screen.getByTestId("thanks-send-button").props.accessibilityState
        .disabled,
    ).toBe(true);
  });
});
