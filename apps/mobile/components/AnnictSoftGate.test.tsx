import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import type { AnnictConnectResult } from "@/lib/annict";

// useAnnictConnect は expo-web-browser / SecureStore 等のネイティブ依存を持つため、
// connect の戻り値だけ差し替えてソフトゲートの UI/分岐を検証する。
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
    render(
      <AnnictSoftGate
        description="視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。"
        surface="watch_history"
      />,
    );

    expect(screen.getByText("Annict 連携が必要です")).toBeTruthy();
    expect(
      screen.getByText(
        "視聴履歴を表示するには Annict との連携が必要です。連携すると、Annict の視聴記録がアニメ名刺に反映されます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("連携する")).toBeTruthy();
  });

  it("description で画面ごとの文言を切り替えられる", () => {
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    expect(
      screen.getByText(
        "作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。",
      ),
    ).toBeTruthy();
  });

  it("表示時に prompt_view イベントを surface 属性付きで送る", async () => {
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    await waitFor(() =>
      expect(loggedFunnelCalls()).toContainEqual(
        expect.objectContaining({
          message: ANNICT_FUNNEL_EVENT,
          attributes: expect.objectContaining({
            "annict.step": "prompt_view",
            "annict.surface": "anime_list",
          }),
        }),
      ),
    );
  });

  it("CTA タップで cta_tap を送り、surface 付きで連携フローを開始する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    expect(mockConnect).toHaveBeenCalledWith({ surface: "anime_list" });
    expect(loggedFunnelCalls()).toContainEqual(
      expect.objectContaining({
        message: ANNICT_FUNNEL_EVENT,
        attributes: expect.objectContaining({
          "annict.step": "cta_tap",
          "annict.surface": "anime_list",
        }),
      }),
    );
  });

  it("連携キャンセル時にキャンセルメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "cancelled" });
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-soft-gate-error")).toBeTruthy();
    });
    expect(screen.getByText("連携をキャンセルしました")).toBeTruthy();
  });

  it("連携エラー時に理由に応じたメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({
      status: "error",
      reason: "exchange_failed",
    });
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-soft-gate-error")).toBeTruthy();
    });
    expect(
      screen.getByText("Annict 連携に失敗しました。もう一度お試しください"),
    ).toBeTruthy();
  });

  it("接続中は CTA を無効化しスピナーを出す", () => {
    mockUseAnnictConnect.mockReturnValue({
      connect: mockConnect,
      disconnect: jest.fn(),
      isConnecting: true,
    });
    render(
      <AnnictSoftGate
        description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
        surface="anime_list"
      />,
    );

    // 接続中はラベルが annict.connecting になり、busy/disabled が立つ。
    const button = screen.getByLabelText("連携中...");
    expect(button.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
