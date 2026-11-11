import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import FeedbackScreen from "@/app/feedback";
import { ApiRequestError } from "@/lib/apiError";

const mockMutate = jest.fn();
const mockAlert = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockIsPending = false;

jest.mock("expo-router", () => ({
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

jest.mock("@/lib/useSendFeedback", () => ({
  FEEDBACK_BODY_MAX_LENGTH: 2000,
  useSendFeedback: () => ({
    mutate: (...args: unknown[]) => mockMutate(...args),
    isPending: mockIsPending,
  }),
}));

jest.mock("@/lib/appInfo", () => ({
  getAppInfo: () => ({
    appVersion: "1.2.0",
    buildVersion: "34",
    commitSha: "abcdef1234567890",
    updateId: "0123456789abcdef",
  }),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

type MutateOptions = {
  onSettled?: () => void;
  onSuccess: () => void;
  onError: (e: unknown) => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockIsPending = false;
});

describe("FeedbackScreen", () => {
  it("本文が空のあいだは送信できない", async () => {
    await render(<FeedbackScreen />);

    await fireEvent.press(screen.getByTestId("feedback-submit"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("送信中は二重に送らない", async () => {
    mockIsPending = true;
    await render(<FeedbackScreen />);
    await fireEvent.changeText(
      screen.getByTestId("feedback-body-input"),
      "落ちます",
    );

    await fireEvent.press(screen.getByTestId("feedback-submit"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("再描画を待たずに連打しても 1 回しか送らない", async () => {
    await render(<FeedbackScreen />);
    await fireEvent.changeText(
      screen.getByTestId("feedback-body-input"),
      "落ちます",
    );

    await fireEvent.press(screen.getByTestId("feedback-submit"));
    await fireEvent.press(screen.getByTestId("feedback-submit"));

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("送信中に追記した本文は送信成功後も残す", async () => {
    await render(<FeedbackScreen />);
    const input = screen.getByTestId("feedback-body-input");
    await fireEvent.changeText(input, "落ちます");
    await fireEvent.press(screen.getByTestId("feedback-submit"));
    await fireEvent.changeText(input, "落ちます。追記");

    const options = mockMutate.mock.calls[0]![1] as MutateOptions;
    await act(() => options.onSuccess());

    expect(screen.getByTestId("feedback-body-input").props.value).toBe(
      "落ちます。追記",
    );
  });

  it("選んだ種類と前後の空白を除いた本文を、アプリのバージョン付きで送る", async () => {
    await render(<FeedbackScreen />);

    await fireEvent.press(screen.getByTestId("feedback-category-request"));
    await fireEvent.changeText(
      screen.getByTestId("feedback-body-input"),
      "  ダークモードがほしい  ",
    );
    await fireEvent.press(screen.getByTestId("feedback-submit"));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "request",
        body: "ダークモードがほしい",
        appVersion: "1.2.0 (34)+abcdef1 ota:01234567",
        platform: expect.any(String),
      }),
      expect.anything(),
    );
  });

  it("送信に成功したらお礼を出し、閉じると前の画面へ戻る", async () => {
    await render(<FeedbackScreen />);
    await fireEvent.changeText(
      screen.getByTestId("feedback-body-input"),
      "落ちます",
    );
    await fireEvent.press(screen.getByTestId("feedback-submit"));

    const options = mockMutate.mock.calls[0]![1] as MutateOptions;
    options.onSuccess();

    expect(mockAlert).toHaveBeenCalledWith(
      "送信しました",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
    const alertOptions = mockAlert.mock.calls[0]![2] as {
      onClose: () => void;
    };
    alertOptions.onClose();
    expect(mockBack).toHaveBeenCalled();
  });

  it("送信に失敗したらサーバーの理由を表示する", async () => {
    await render(<FeedbackScreen />);
    await fireEvent.changeText(
      screen.getByTestId("feedback-body-input"),
      "落ちます",
    );
    await fireEvent.press(screen.getByTestId("feedback-submit"));

    const options = mockMutate.mock.calls[0]![1] as MutateOptions;
    options.onError(new ApiRequestError(429, "上限に達しました"));

    expect(mockAlert).toHaveBeenCalledWith(
      "送信できませんでした",
      "上限に達しました",
      { okLabel: "OK" },
    );
  });

  it("遷移履歴が無い場合、戻るボタンでホームへ戻る", async () => {
    mockCanGoBack = false;
    await render(<FeedbackScreen />);

    await fireEvent.press(screen.getByTestId("feedback-back-button"));

    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
