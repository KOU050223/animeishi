/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { createElement } from "react";
import { render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AnnictCallbackScreen from "@/app/annict.web";
import { ANNICT_CONNECTION_QUERY_KEY } from "@/lib/annict";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: async () => "clerk_jwt", userId: "user_test" }),
}));

const mockExchange = jest.fn();
jest.mock("@/lib/annict/useAnnictConnect.web", () => ({
  exchangeAnnictWebCallback: (...args: unknown[]) => mockExchange(...args),
}));

// バレルのネイティブ依存（SecureStore 等）を避け、画面が使う実装だけ差し替える。
// 正規オリジンへの中継は今回の対象外なので relayTarget は常に null。
jest.mock("@/lib/annict", () => ({
  annictErrorKey: (reason: string) => `annict.error.${reason}`,
  ANNICT_CONNECTION_QUERY_KEY: ["annict", "connection"],
  resolveAnnictRelayTarget: () => null,
}));

// この jsdom 環境は IS_REACT_ACT_ENVIRONMENT が React 側から見えないため、
// waitFor / act を通すと "not configured to support act" の警告が出る。
// 画面の async IIFE（exchange → invalidate → replace）が終わるまで
// spy を直接ポーリングする。
async function waitForMockCall(
  calls: unknown[][],
  predicate: (call: unknown[]) => boolean,
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (calls.some(predicate)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for mock call");
}

describe("AnnictCallbackScreen (web)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("連携成功で連携状態と評価クエリを無効化して一覧へ戻る", async () => {
    mockExchange.mockResolvedValue({ status: "success" });
    const client = new QueryClient();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    await render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AnnictCallbackScreen),
      ),
    );

    // 連携後は Annict レビュー由来の初期評価（annictRating）を GET で
    // 拾えるため、未連携時に取った評価キャッシュを捨てる（issue #416 レビュー）。
    await waitForMockCall(invalidateSpy.mock.calls, ([arg]) =>
      JSON.stringify(arg).includes('"work-ratings"'),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ANNICT_CONNECTION_QUERY_KEY,
    });
    await waitForMockCall(mockReplace.mock.calls, (call) => call.length > 0);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/library?section=anime");
  });
});
