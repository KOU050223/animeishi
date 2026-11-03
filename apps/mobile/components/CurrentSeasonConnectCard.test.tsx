import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { CurrentSeasonConnectCard } from "@/components/CurrentSeasonConnectCard";
import type { AnnictConnectResult } from "@/lib/annict";

// useAnnictConnect は expo-web-browser / SecureStore 等のネイティブ依存を持つため、
// connect の戻り値だけ差し替えてカードの UI/分岐を検証する。
const mockConnect = jest.fn<Promise<AnnictConnectResult>, []>();
const mockUseAnnictConnect = jest.fn();

jest.mock("@/lib/annict/useAnnictConnect", () => ({
  useAnnictConnect: () => mockUseAnnictConnect(),
}));

const loggedFunnelCalls = () =>
  jest.mocked(Sentry.logger.info).mock.calls.map(([message, attributes]) => ({
    message,
    attributes: attributes as Record<string, string>,
  }));

beforeEach(async () => {
  jest.clearAllMocks();
  mockUseAnnictConnect.mockReturnValue({
    connect: mockConnect,
    disconnect: jest.fn(),
    isConnecting: false,
  });
});

describe("CurrentSeasonConnectCard", () => {
  it("呼び出し側が渡した説明文と CTA ラベルをレンダリングする", async () => {
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    expect(
      screen.getByText("Annict と連携すると、ここに今期視聴中の作品が並びます"),
    ).toBeTruthy();
    expect(screen.getByText("Annict と連携する")).toBeTruthy();
  });

  it("表示時に prompt_view イベントを surface 属性付きで送る", async () => {
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    await waitFor(() =>
      expect(loggedFunnelCalls()).toContainEqual(
        expect.objectContaining({
          message: ANNICT_FUNNEL_EVENT,
          attributes: expect.objectContaining({
            "annict.step": "prompt_view",
            "annict.surface": "home_current_season",
          }),
        }),
      ),
    );
  });

  it("CTA タップで cta_tap を送り、surface 付きで連携フローを開始する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    await fireEvent.press(screen.getByText("Annict と連携する"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    expect(mockConnect).toHaveBeenCalledWith({
      surface: "home_current_season",
    });
    expect(loggedFunnelCalls()).toContainEqual(
      expect.objectContaining({
        message: ANNICT_FUNNEL_EVENT,
        attributes: expect.objectContaining({
          "annict.step": "cta_tap",
          "annict.surface": "home_current_season",
        }),
      }),
    );
  });

  it("連携キャンセル時にキャンセルメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "cancelled" });
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    await fireEvent.press(screen.getByText("Annict と連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("current-season-connect-error")).toBeTruthy();
    });
    expect(screen.getByText("連携をキャンセルしました")).toBeTruthy();
  });

  it("連携エラー時に理由に応じたメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({
      status: "error",
      reason: "exchange_failed",
    });
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    await fireEvent.press(screen.getByText("Annict と連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("current-season-connect-error")).toBeTruthy();
    });
    expect(
      screen.getByText("Annict 連携に失敗しました。もう一度お試しください"),
    ).toBeTruthy();
  });

  it("接続中は CTA を無効化しスピナーを出す", async () => {
    mockUseAnnictConnect.mockReturnValue({
      connect: mockConnect,
      disconnect: jest.fn(),
      isConnecting: true,
    });
    await render(
      <CurrentSeasonConnectCard
        description="Annict と連携すると、ここに今期視聴中の作品が並びます"
        connectLabel="Annict と連携する"
        surface="home_current_season"
      />,
    );

    const button = screen.getByLabelText("連携中...");
    expect(button.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
