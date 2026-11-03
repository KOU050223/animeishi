import { describe, it, expect } from "vitest";
import { buildWorkListShareUrl } from "./shareUrl";

// ベースには Web ドメイン（EXPO_PUBLIC_WEB_URL 由来の webUrl）を渡す
// 想定。/share/* は Web Worker が API へ転送する（issue #408）。
describe("buildWorkListShareUrl", () => {
  it("Web の共有ページを指す URL を組み立てる", () => {
    expect(buildWorkListShareUrl("tok-123", "https://web.example.com")).toBe(
      "https://web.example.com/share/work-lists/tok-123",
    );
  });

  it("末尾スラッシュの重複を避け、トークンはエンコードする", () => {
    expect(buildWorkListShareUrl("a/b?c", "https://web.example.com/")).toBe(
      "https://web.example.com/share/work-lists/a%2Fb%3Fc",
    );
  });
});
