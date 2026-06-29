import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import type { AnnictConnectResult } from "@/lib/annict";

// useAnnictConnect は expo-web-browser / SecureStore 等のネイティブ依存を持つため、
// connect の戻り値だけ差し替えてソフトゲートの UI/分岐を検証する。
const mockConnect = jest.fn<Promise<AnnictConnectResult>, []>();
const mockUseAnnictConnect = jest.fn();

jest.mock("@/lib/annict/useAnnictConnect", () => ({
  useAnnictConnect: () => mockUseAnnictConnect(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAnnictConnect.mockReturnValue({
    connect: mockConnect,
    disconnect: jest.fn(),
    isConnecting: false,
  });
});

describe("AnnictSoftGate", () => {
  it("タイトル・説明・連携 CTA をレンダリングする", () => {
    render(<AnnictSoftGate description="annict.softGate.watchHistory" />);

    expect(screen.getByText("Annict 連携が必要です")).toBeTruthy();
    expect(
      screen.getByText(
        "視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("連携する")).toBeTruthy();
  });

  it("description で画面ごとの文言を切り替えられる", () => {
    render(<AnnictSoftGate description="annict.softGate.works" />);

    expect(
      screen.getByText(
        "作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。",
      ),
    ).toBeTruthy();
  });

  it("CTA タップで連携フローを開始する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    render(<AnnictSoftGate description="annict.softGate.works" />);

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  it("連携キャンセル時にキャンセルメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "cancelled" });
    render(<AnnictSoftGate description="annict.softGate.works" />);

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-soft-gate-error")).toHaveTextContent(
        "連携をキャンセルしました",
      );
    });
  });

  it("連携エラー時に理由に応じたメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({
      status: "error",
      reason: "exchange_failed",
    });
    render(<AnnictSoftGate description="annict.softGate.works" />);

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-soft-gate-error")).toHaveTextContent(
        "Annict 連携に失敗しました。もう一度お試しください",
      );
    });
  });

  it("接続中は CTA を無効化しスピナーを出す", () => {
    mockUseAnnictConnect.mockReturnValue({
      connect: mockConnect,
      disconnect: jest.fn(),
      isConnecting: true,
    });
    render(<AnnictSoftGate description="annict.softGate.works" />);

    // 接続中はラベルが annict.connecting になり、busy/disabled が立つ。
    const button = screen.getByLabelText("連携中...");
    expect(button.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
