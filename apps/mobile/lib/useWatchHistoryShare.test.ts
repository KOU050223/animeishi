// 視聴履歴の共有 URL 組み立て（issue #236）のテスト。
// ベースは Web ドメイン（EXPO_PUBLIC_WEB_URL 由来の webUrl）を渡す想定。
// /share/* は Web Worker が API へ転送する（issue #408）。
// Expo 依存の import を含むモジュールのため vitest ではなく jest で書く。
import { buildWatchHistoryShareUrl } from "./useWatchHistoryShare";

describe("buildWatchHistoryShareUrl", () => {
  it("Web の共有ページを指す URL を組み立てる", () => {
    expect(
      buildWatchHistoryShareUrl("tok-123", "https://web.example.com"),
    ).toBe("https://web.example.com/share/watch-history/tok-123");
  });

  it("末尾スラッシュの重複を避け、トークンはエンコードする", () => {
    expect(buildWatchHistoryShareUrl("a/b?c", "https://web.example.com/")).toBe(
      "https://web.example.com/share/watch-history/a%2Fb%3Fc",
    );
  });
});
