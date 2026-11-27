import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ExchangeQueuedOverlay } from "@/features/friends/components/ExchangeQueuedOverlay";
import { haptics } from "@/lib/haptics";

jest.mock("@/lib/haptics", () => ({
  haptics: {
    success: jest.fn(),
    warning: jest.fn(),
    selection: jest.fn(),
    impactLight: jest.fn(),
  },
}));

const mockOnClose = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ExchangeQueuedOverlay", () => {
  it("ミニ名刺の名前と「接続が回復したら名刺交換が完了します」を表示する", async () => {
    await render(
      <ExchangeQueuedOverlay
        uid="user_partner"
        miniMeishi={{ username: "オフライン相手" }}
        onClose={mockOnClose}
      />,
    );

    expect(screen.getByText("名刺交換を受け付けました")).toBeTruthy();
    expect(
      screen.getByText("接続が回復したら名刺交換が完了します"),
    ).toBeTruthy();
    expect(screen.getByText("オフライン相手")).toBeTruthy();
    // 受け付けた感触はハプティクスでも伝える。
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it("ミニ名刺が無い QR でもユーザー ID を名代にして受付画面を出す", async () => {
    await render(
      <ExchangeQueuedOverlay uid="user_partner" onClose={mockOnClose} />,
    );

    expect(screen.getByText("user_partner")).toBeTruthy();
    expect(
      screen.getByText("接続が回復したら名刺交換が完了します"),
    ).toBeTruthy();
  });

  it("「閉じる」で onClose を呼ぶ", async () => {
    await render(
      <ExchangeQueuedOverlay uid="user_partner" onClose={mockOnClose} />,
    );

    await fireEvent.press(screen.getByTestId("exchange-queued-close"));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("onShowMyQr を渡すと「自分の QR も見せる」を出し、押すと呼ばれる（issue #682）", async () => {
    const onShowMyQr = jest.fn();
    await render(
      <ExchangeQueuedOverlay
        uid="user_partner"
        onClose={mockOnClose}
        onShowMyQr={onShowMyQr}
      />,
    );

    await fireEvent.press(screen.getByTestId("exchange-queued-show-my-qr"));

    expect(onShowMyQr).toHaveBeenCalledTimes(1);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("onShowMyQr を渡さないとき「自分の QR も見せる」は出さない", async () => {
    await render(
      <ExchangeQueuedOverlay uid="user_partner" onClose={mockOnClose} />,
    );

    expect(screen.queryByTestId("exchange-queued-show-my-qr")).toBeNull();
  });
});
