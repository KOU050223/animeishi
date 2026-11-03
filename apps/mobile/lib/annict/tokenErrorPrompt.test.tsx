import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { ApiRequestError } from "@/lib/apiError";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import {
  isAnnictTokenError,
  useAnnictTokenErrorPrompt,
} from "./tokenErrorPrompt";
import type { AnnictConnectResult } from "@/lib/annict";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../../__mocks__/@clerk/expo";

// useAnnictConnect は expo-web-browser / SecureStore 等のネイティブ依存を
// 持つため、connect の戻り値だけ差し替えてダイアログの分岐を検証する。
const mockConnect = jest.fn<
  Promise<AnnictConnectResult>,
  [{ surface?: string }?]
>();
const mockUseAnnictConnect = jest.fn();
const mockConfirm = jest.fn();
const mockAlert = jest.fn();

jest.mock("@/lib/annict/useAnnictConnect", () => ({
  useAnnictConnect: () => mockUseAnnictConnect(),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

const loggedFunnelCalls = () =>
  jest.mocked(Sentry.logger.info).mock.calls.map(([message, attributes]) => ({
    message,
    attributes: attributes as Record<string, string>,
  }));

// フックが useQueryClient を持つため全テストで Provider が必要。
// QueryClient はテストごとに作って invalidateQueries を spy できるようにする。
const makeWrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

beforeEach(async () => {
  resetAuth();
  jest.clearAllMocks();
  loggedInUser({ userId: "user_test" });
  setMockClerkState({ getToken: async () => "test-token" });
  mockUseAnnictConnect.mockReturnValue({
    connect: mockConnect,
    disconnect: jest.fn(),
    isConnecting: false,
  });
});

describe("isAnnictTokenError", () => {
  it("annict_token_required / annict_token_invalid を true と判定する", () => {
    expect(
      isAnnictTokenError(
        new ApiRequestError(401, "x", "annict_token_required"),
      ),
    ).toBe(true);
    expect(
      isAnnictTokenError(new ApiRequestError(401, "x", "annict_token_invalid")),
    ).toBe(true);
  });

  it("それ以外のエラーは false と判定する", () => {
    expect(
      isAnnictTokenError(new ApiRequestError(502, "x", "annict_upstream")),
    ).toBe(false);
    expect(isAnnictTokenError(new ApiRequestError(500, "x"))).toBe(false);
    expect(isAnnictTokenError(new Error("network"))).toBe(false);
    expect(isAnnictTokenError(undefined)).toBe(false);
  });
});

describe("useAnnictTokenErrorPrompt", () => {
  it("トークン起因でないエラーは処理せず false を返す", async () => {
    const { result } = await renderHook(
      () => useAnnictTokenErrorPrompt("work_detail_sheet"),
      { wrapper: makeWrapper(new QueryClient()) },
    );

    expect(
      result.current(new ApiRequestError(500, "視聴履歴の更新に失敗しました")),
    ).toBe(false);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("annict_token_required で「連携する/あとで」の確認ダイアログを出し prompt_view を送る", async () => {
    const { result } = await renderHook(
      () => useAnnictTokenErrorPrompt("work_detail_sheet"),
      { wrapper: makeWrapper(new QueryClient()) },
    );

    expect(
      result.current(new ApiRequestError(401, "x", "annict_token_required")),
    ).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith(
      "Annict 連携が必要です",
      "Annict と連携すると視聴記録を残せます",
      expect.any(Function),
      { confirmLabel: "連携する", cancelLabel: "あとで" },
    );
    await waitFor(() =>
      expect(loggedFunnelCalls()).toContainEqual(
        expect.objectContaining({
          message: ANNICT_FUNNEL_EVENT,
          attributes: expect.objectContaining({
            "annict.step": "prompt_view",
            "annict.surface": "work_detail_sheet",
          }),
        }),
      ),
    );
    // 確認前は連携フローを開始しない。
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("「連携する」で cta_tap を送り surface 付きで連携フローを開始する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    const { result } = await renderHook(
      () => useAnnictTokenErrorPrompt("analysis"),
      { wrapper: makeWrapper(new QueryClient()) },
    );
    result.current(new ApiRequestError(401, "x", "annict_token_invalid"));

    // confirm の onConfirm（第3引数）を呼んで「連携する」押下を再現する。
    const onConfirm = mockConfirm.mock.calls[0][2] as () => void;
    onConfirm();

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
    expect(mockConnect).toHaveBeenCalledWith({ surface: "analysis" });
    expect(loggedFunnelCalls()).toContainEqual(
      expect.objectContaining({
        message: ANNICT_FUNNEL_EVENT,
        attributes: expect.objectContaining({
          "annict.step": "cta_tap",
          "annict.surface": "analysis",
        }),
      }),
    );
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("連携が成功したとき作品詳細と視聴履歴のクエリを無効化する", async () => {
    mockConnect.mockResolvedValueOnce({ status: "success" });
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = await renderHook(
      () => useAnnictTokenErrorPrompt("work_detail_sheet"),
      { wrapper: makeWrapper(queryClient) },
    );
    result.current(new ApiRequestError(401, "x", "annict_token_required"));

    const onConfirm = mockConfirm.mock.calls[0][2] as () => void;
    onConfirm();

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(2));
    // プレフィックス指定で userId/作品別のクエリをまとめて無効化する。
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["works", "detail"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WATCH_HISTORY_QUERY_KEY,
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("連携が失敗で終わったときは失敗アラートを出す", async () => {
    mockConnect.mockResolvedValueOnce({
      status: "error",
      reason: "exchange_failed",
    });
    const { result } = await renderHook(
      () => useAnnictTokenErrorPrompt("work_detail_sheet"),
      { wrapper: makeWrapper(new QueryClient()) },
    );
    result.current(new ApiRequestError(401, "x", "annict_token_required"));

    const onConfirm = mockConfirm.mock.calls[0][2] as () => void;
    onConfirm();

    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));
    expect(mockAlert).toHaveBeenCalledWith(
      "Annict 連携に失敗しました",
      "Annict 連携に失敗しました。もう一度お試しください",
      { okLabel: "OK" },
    );
  });
});
