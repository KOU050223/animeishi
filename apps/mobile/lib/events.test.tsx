import { renderHook, waitFor } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { EVENT_RATE_LIMIT } from "@animeishi/observability";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import {
  flushTrackedEvents,
  resetEventTrackingForTest,
  setEventContext,
  trackEvent,
} from "./events";
import { useEventTrackingContext } from "./useEventTrackingContext";

// ハッシュ化は expo-crypto 経由。テストでは固定値を返して
// 「生の userId を送らない」「先頭16文字に切る」ことだけを検証する。
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(
    async () =>
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
}));

// useEventTrackingContext が読むルートセグメント。テストでは固定値にする。
const mockSegments = jest.fn((): string[] => ["(tabs)", "qr"]);
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments(),
}));

const infoMock = () => jest.mocked(Sentry.logger.info);

beforeEach(() => {
  jest.clearAllMocks();
  mockSegments.mockReturnValue(["(tabs)", "qr"]);
  resetAuth();
  resetEventTrackingForTest();
});

describe("trackEvent", () => {
  it("イベント名を message と event.name 属性に付けて送る", async () => {
    trackEvent("meishi_save");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const [message, attributes] = infoMock().mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(message).toBe("meishi_save");
    expect(attributes["event.name"]).toBe("meishi_save");
    expect(attributes.platform).toEqual(expect.any(String));
    expect(attributes.app_version).toEqual(expect.any(String));
  });

  it("同期済みのコンテキストから screen と user_key を付ける", async () => {
    setEventContext({ userId: "user_ctx_raw", screen: "meishi/edit" });

    trackEvent("meishi_save");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes.screen).toBe("meishi/edit");
    // 生の userId は送らず、ソルト付きハッシュの先頭16文字を user_key にする。
    expect(attributes.user_key).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_ctx_raw");
  });

  it("未サインイン（userId 未設定）なら user_key を付けずに送る", async () => {
    trackEvent("qr_scan_start");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes.user_key).toBeUndefined();
  });

  it("options の userId を優先し、null はコンテキストへのフォールバックを止める", async () => {
    setEventContext({ userId: "user_ctx_raw" });

    trackEvent(
      "favorite_toggle",
      { action: "add" },
      { userId: "user_opt_raw" },
    );
    trackEvent("favorite_toggle", { action: "remove" }, { userId: null });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(2));
    const crypto = jest.requireMock("expo-crypto");
    // options 側の userId でハッシュ化されていること
    expect(crypto.digestStringAsync).toHaveBeenCalledWith(
      "SHA-256",
      expect.stringContaining("user_opt_raw"),
    );
    // ハッシュ化の有無で送信順が入れ替わりうるため属性で引き当てる。
    const attrsOf = (action: string) =>
      infoMock().mock.calls.find(
        (c) => (c[1] as Record<string, string>).action === action,
      )?.[1] as Record<string, string>;
    expect(attrsOf("add").user_key).toBe("0123456789abcdef");
    // null 指定では user_key が付かない（コンテキストへフォールバックしない）
    expect(attrsOf("remove").user_key).toBeUndefined();
  });

  it("イベント固有の属性はそのまま載る", async () => {
    trackEvent("watch_status_change", { from: "WATCHING", to: "WATCHED" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes.from).toBe("WATCHING");
    expect(attributes.to).toBe("WATCHED");
  });

  it("ハッシュ化に失敗してもイベント自体は送る", async () => {
    const crypto = jest.requireMock("expo-crypto");
    crypto.digestStringAsync.mockRejectedValueOnce(new Error("no native"));

    trackEvent("meishi_save", undefined, { userId: "user_x" });

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    expect(attributes.user_key).toBeUndefined();
  });

  it("同一イベントはウィンドウあたりの上限を超えると捨てる", async () => {
    for (let i = 0; i < EVENT_RATE_LIMIT.maxPerWindow + 5; i++) {
      trackEvent("qr_scan_start");
    }
    // 別イベントは同じ枠を消費しない
    trackEvent("meishi_save");

    await waitFor(() =>
      expect(infoMock()).toHaveBeenCalledTimes(
        EVENT_RATE_LIMIT.maxPerWindow + 1,
      ),
    );
    const names = infoMock().mock.calls.map((c) => c[0]);
    expect(names.filter((n) => n === "qr_scan_start").length).toBe(
      EVENT_RATE_LIMIT.maxPerWindow,
    );
    expect(names).toContain("meishi_save");
  });

  it("Sentry 送信自体が例外を投げても呼び出し側へ漏れない", async () => {
    infoMock().mockImplementationOnce(() => {
      throw new Error("sentry down");
    });
    expect(() => trackEvent("meishi_save")).not.toThrow();
    await flushTrackedEvents();
  });
});

describe("useEventTrackingContext", () => {
  it("画面パスと userId を計測コンテキストへ同期する", async () => {
    loggedInUser({ userId: "user_hook_raw" });
    renderHook(() => useEventTrackingContext());

    trackEvent("qr_exchange_start");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    // route group "(tabs)" を除いた残りを "/" で繋いだ値が screen になる
    expect(attributes.screen).toBe("qr");
    expect(attributes.user_key).toBe("0123456789abcdef");
    expect(JSON.stringify(attributes)).not.toContain("user_hook_raw");
  });

  it("動的セグメントはルートパターン（[uid]）のまま載せ、実値は送らない", async () => {
    mockSegments.mockReturnValue(["user", "[uid]"]);
    renderHook(() => useEventTrackingContext());

    trackEvent("qr_exchange_start");

    await waitFor(() => expect(infoMock()).toHaveBeenCalledTimes(1));
    const attributes = infoMock().mock.calls[0][1] as Record<string, string>;
    // "/user/xxx" の実値ではなくルートパターンを送る
    expect(attributes.screen).toBe("user/[uid]");
  });
});
