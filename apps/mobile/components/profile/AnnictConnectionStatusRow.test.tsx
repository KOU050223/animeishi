import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { AnnictConnectionStatusRow } from "@/components/profile/AnnictConnectionStatusRow";
import type { AnnictConnectResult } from "@/lib/annict";

// useAnnictConnect は expo-web-browser / SecureStore 等のネイティブ依存を持つため、
// connect の戻り値だけ差し替えて行の UI/分岐を検証する。
const mockConnect = jest.fn<Promise<AnnictConnectResult>, []>();
const mockUseAnnictConnect = jest.fn();

jest.mock("@/lib/annict/useAnnictConnect", () => ({
  useAnnictConnect: () => mockUseAnnictConnect(),
}));

// 連携状態をテストごとに切り替えられるよう、変数経由で返す。
let mockAnnictConnection = { isConnected: false, isLoading: false };
jest.mock("@/lib/annict/useAnnictConnection", () => ({
  useAnnictConnection: () => mockAnnictConnection,
}));

const loggedFunnelCalls = () =>
  jest.mocked(Sentry.logger.info).mock.calls.map(([message, attributes]) => ({
    message,
    attributes: attributes as Record<string, string>,
  }));

const renderRow = (props?: { onShowDetails?: () => void }) =>
  render(
    <AnnictConnectionStatusRow
      connectedLabel="Annict と連携済み"
      unconnectedLabel="Annict と連携していません"
      connectLabel="連携する"
      surface="profile_header"
      onShowDetails={props?.onShowDetails}
    />,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  mockUseAnnictConnect.mockReturnValue({
    connect: mockConnect,
    disconnect: jest.fn(),
    isConnecting: false,
  });
  mockAnnictConnection = { isConnected: false, isLoading: false };
});

describe("AnnictConnectionStatusRow", () => {
  it("未連携ならステータスと連携 CTA を 1 行で表示する", async () => {
    await renderRow();

    expect(screen.getByText("Annict と連携していません")).toBeTruthy();
    expect(screen.getByText("連携する")).toBeTruthy();
  });

  it("連携済みなら連携済みラベルを表示し連携 CTA は出さない", async () => {
    mockAnnictConnection = { isConnected: true, isLoading: false };
    await renderRow();

    expect(screen.getByText("Annict と連携済み")).toBeTruthy();
    expect(screen.queryByText("連携する")).toBeNull();
  });

  it("連携済み行のタップで詳細への遷移コールバックを呼ぶ", async () => {
    mockAnnictConnection = { isConnected: true, isLoading: false };
    const onShowDetails = jest.fn();
    await renderRow({ onShowDetails });

    await fireEvent.press(screen.getByLabelText("Annict と連携済み"));

    expect(onShowDetails).toHaveBeenCalledTimes(1);
  });

  it("未連携の表示時に prompt_view を surface 属性付きで送る", async () => {
    await renderRow();

    await waitFor(() =>
      expect(loggedFunnelCalls()).toContainEqual(
        expect.objectContaining({
          message: ANNICT_FUNNEL_EVENT,
          attributes: expect.objectContaining({
            "annict.step": "prompt_view",
            "annict.surface": "profile_header",
          }),
        }),
      ),
    );
  });

  it("連携済みの表示では prompt_view を送らない", async () => {
    mockAnnictConnection = { isConnected: true, isLoading: false };
    await renderRow();

    await waitFor(() => {
      expect(screen.getByText("Annict と連携済み")).toBeTruthy();
    });
    expect(loggedFunnelCalls()).toHaveLength(0);
  });

  it("CTA タップで cta_tap を送り、surface 付きで連携フローを開始する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    await renderRow();

    await fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
    expect(mockConnect).toHaveBeenCalledWith({ surface: "profile_header" });
    expect(loggedFunnelCalls()).toContainEqual(
      expect.objectContaining({
        message: ANNICT_FUNNEL_EVENT,
        attributes: expect.objectContaining({
          "annict.step": "cta_tap",
          "annict.surface": "profile_header",
        }),
      }),
    );
  });

  it("連携キャンセル時にキャンセルメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "cancelled" });
    await renderRow();

    await fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-connection-status-error")).toBeTruthy();
    });
    expect(screen.getByText("連携をキャンセルしました")).toBeTruthy();
  });

  it("連携エラー時に理由に応じたメッセージを表示する", async () => {
    mockConnect.mockResolvedValueOnce({
      status: "error",
      reason: "exchange_failed",
    });
    await renderRow();

    await fireEvent.press(screen.getByText("連携する"));

    await waitFor(() => {
      expect(screen.getByTestId("annict-connection-status-error")).toBeTruthy();
    });
    expect(
      screen.getByText("Annict 連携に失敗しました。もう一度お試しください"),
    ).toBeTruthy();
  });
});
