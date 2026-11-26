import { renderHook, waitFor } from "@testing-library/react-native";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  ANNICT_FUNNEL_EVENT,
  EVENT_RATE_LIMIT,
} from "@animeishi/observability";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { resetEventTrackingForTest } from "@/lib/events";
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

const infoMock = () => jest.mocked(captureAnalyticsEvent);

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  // 汎用経路（lib/events.ts）のレート制限・ハッシュキャッシュ・
  // コンテキストはモジュール状態なのでテスト間でリセットする。
  resetEventTrackingForTest();
});

describe("trackAnnictFunnel", () => {
  it("step / surface / platform を属性に付けて送る", async () => {
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
    const attributes = infoMock().mock.calls[0]?.[1] as Record<string, string>;
    // sha256 ダイジェストの先頭16文字。ソルト込み入力がそのまま出ないこと。
    expect(attributes["annict.user_key"]).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_2abcRAW");
  });

  it("userId が無くても user_key 無しで送信できる", async () => {
    trackAnnictFunnel({ step: "cta_tap", surface: "home_card" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0]?.[1] as Record<string, string>;
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
    const attributes = infoMock().mock.calls[0]?.[1] as Record<string, string>;
    expect(attributes["annict.step"]).toBe("prompt_view");
    expect(attributes["annict.user_key"]).toBeUndefined();
  });

  it("prompt_view の連打で上限に達しても cta_tap / oauth_result は送れる", async () => {
    // ファネルは全ステップ同一イベント名を共有するため、レート制限は
    // ステップ別キーで分けている。表示の連打が結果の記録を潰さないこと。
    for (let i = 0; i < EVENT_RATE_LIMIT.maxPerWindow + 5; i++) {
      trackAnnictFunnel({ step: "prompt_view" });
    }
    trackAnnictFunnel({ step: "cta_tap" });
    trackAnnictFunnel({ step: "oauth_result", result: "error" });

    await waitFor(() =>
      expect(infoMock()).toHaveBeenCalledTimes(
        EVENT_RATE_LIMIT.maxPerWindow + 2,
      ),
    );
    const steps = infoMock().mock.calls.map((c) => c[1]["annict.step"]);
    expect(steps.filter((s) => s === "prompt_view").length).toBe(
      EVENT_RATE_LIMIT.maxPerWindow,
    );
    expect(steps).toContain("cta_tap");
    expect(steps).toContain("oauth_result");
  });
});

describe("annict_connect_complete", () => {
  it("oauth_result が success のときだけ連携完了イベントも送る", async () => {
    trackAnnictFunnel({
      step: "oauth_result",
      surface: "anime_list",
      result: "success",
    });
    trackAnnictFunnel({ step: "oauth_result", result: "cancelled" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(3));
    const completes = infoMock().mock.calls.filter(
      (c) => c[0] === "annict_connect_complete",
    );
    expect(completes).toHaveLength(1);
    expect(completes[0]?.[1].surface).toBe("anime_list");
  });
});

describe("useAnnictFunnel", () => {
  it("surface を束縛し、サインイン済みなら user_key を付ける", async () => {
    loggedInUser({ userId: "user_signed_in" });
    const { result } = await renderHook(() => useAnnictFunnel("profile_card"));

    result.current("cta_tap");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    // waitFor で 1 回呼ばれたことが保証されている。
    const [message, attributes] = infoMock().mock.calls[0]!;
    expect(message).toBe(ANNICT_FUNNEL_EVENT);
    expect(attributes["annict.step"]).toBe("cta_tap");
    expect(attributes["annict.surface"]).toBe("profile_card");
    expect(attributes["annict.user_key"]).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_signed_in");
  });
});
