import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("エラーメッセージと再試行ボタンを表示する", () => {
    render(
      <RootErrorBoundary error={new Error("テストエラー")} retry={jest.fn()} />,
    );

    expect(screen.getByText("予期しないエラーが発生しました")).toBeTruthy();
    expect(screen.getByLabelText("もう一度試す")).toBeTruthy();
  });

  it("再試行ボタンで retry が呼ばれる", () => {
    const retry = jest.fn();
    render(<RootErrorBoundary error={new Error("boom")} retry={retry} />);

    fireEvent.press(screen.getByLabelText("もう一度試す"));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("表示したエラーを Sentry に送信する", () => {
    const error = new Error("boom");
    render(<RootErrorBoundary error={error} retry={jest.fn()} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
