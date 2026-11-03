import { describe, expect, it } from "vitest";
import { buildCustomTierListShareUrl, buildTierListShareUrl } from "./shareUrl";

// ベースには Web ドメイン（EXPO_PUBLIC_WEB_URL 由来の webUrl）を渡す
// 想定。/share/* は Web Worker が API へ転送する（issue #408）。
describe("buildTierListShareUrl", () => {
  it("Web の共有ページ形式の URL を組み立てる", () => {
    const url = buildTierListShareUrl("abc-123", "https://web.example.com");
    expect(url).toBe("https://web.example.com/share/tier-lists/abc-123");
  });

  it("トークンは URL エンコードされる", () => {
    const url = buildTierListShareUrl("a/b?c", "https://web.example.com");
    expect(url).toContain(encodeURIComponent("a/b?c"));
  });
});

describe("buildCustomTierListShareUrl", () => {
  it("自由作成 tier 表の共有ページ形式の URL を組み立てる", () => {
    const url = buildCustomTierListShareUrl(
      "abc-123",
      "https://web.example.com",
    );
    expect(url).toBe("https://web.example.com/share/custom-tier-lists/abc-123");
  });

  it("トークンは URL エンコードされる", () => {
    const url = buildCustomTierListShareUrl("a/b?c", "https://web.example.com");
    expect(url).toContain(encodeURIComponent("a/b?c"));
  });
});
