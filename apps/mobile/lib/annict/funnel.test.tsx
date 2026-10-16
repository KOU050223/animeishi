import { renderHook, waitFor } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { ANNICT_FUNNEL_EVENT } from "@animeishi/observability";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { resetEventTrackingForTest } from "../events";
import { trackAnnictFunnel, useAnnictFunnel } from "./funnel";

// ハッシュ化は expo-crypto 経由。テストでは固定値を返して
// 「生の userId を送らない」「先頭16文字に切る」ことだけを検証する。
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(
    async () =>
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
}));

const infoMock = () => jest.mocked(Sentry.logger.info);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  // 汎用経路（lib/events.ts）のレート制限・ハッシュキャッシュ・
  // コンテキストはモジュール状態なのでテスト間でリセットする。
  resetEventTrackingForTest();
});

describe("trackAnnictFunnel", () => {
  it("step / surface / platform を属性に付けて Sentry Logs へ送る", async () => {
    trackAnnictFunnel({ step: "prompt_view", surface: "anime_list" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    expect(infoMock()).toHaveBeenCalledWith(ANNICT_FUNNEL_EVENT, {
      "annict.step": "prompt_view",
      "annict.surface": "anime_list",
      platform: expect.any(String),
    });
  });

  it("oauth_result は result / reason を載せる", async () => {
    trackAnnictFunnel({
      step: "oauth_result",
      surface: "watch_history",
      result: "error",
      reason: "exchange_failed",
    });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    expect(infoMock()).toHaveBeenCalledWith(
      ANNICT_FUNNEL_EVENT,
      expect.objectContaining({
        "annict.result": "error",
        "annict.reason": "exchange_failed",
      }),
    );
  });

  it("userId は生値を送らずハッシュ化した user_key を付ける", async () => {
    trackAnnictFunnel({
      step: "prompt_view",
      surface: "tier_list",
      userId: "user_2abcRAW",
    });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    // sha256 ダイジェストの先頭16文字。ソルト込み入力がそのまま出ないこと。
    expect(attributes["annict.user_key"]).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_2abcRAW");
  });

  it("userId が無くても user_key 無しで送信できる", async () => {
    trackAnnictFunnel({ step: "cta_tap", surface: "home_card" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes["annict.user_key"]).toBeUndefined();
    expect(attributes["annict.step"]).toBe("cta_tap");
  });

  it("ハッシュ化に失敗してもイベント自体は送る", async () => {
    const crypto = jest.requireMock("expo-crypto");
    crypto.digestStringAsync.mockRejectedValueOnce(new Error("no native"));

    trackAnnictFunnel({
      step: "prompt_view",
      surface: "watch_history",
      userId: "user_x",
    });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes["annict.step"]).toBe("prompt_view");
    expect(attributes["annict.user_key"]).toBeUndefined();
  });
});

describe("useAnnictFunnel", () => {
  it("surface を束縛し、サインイン済みなら user_key を付ける", async () => {
    loggedInUser({ userId: "user_signed_in" });
    const { result } = renderHook(() => useAnnictFunnel("profile_card"));

    result.current("cta_tap");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const [message, attributes] = infoMock().mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(message).toBe(ANNICT_FUNNEL_EVENT);
    expect(attributes["annict.step"]).toBe("cta_tap");
    expect(attributes["annict.surface"]).toBe("profile_card");
    expect(attributes["annict.user_key"]).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_signed_in");
  });
});
