import { describe, it, expect } from "vitest";
import { buildTierListShareUrl } from "./shareUrl";

describe("buildTierListShareUrl", () => {
  it("webBaseUrl とトークンから共有 URL を組み立てる", () => {
    const url = buildTierListShareUrl("abc-123", "https://web.example.com");
    expect(url).toBe("https://web.example.com/share/tier-lists/abc-123");
  });

  it("トークン中の特殊文字はエンコードされる", () => {
    const url = buildTierListShareUrl("a/b?c", "https://web.example.com");
    expect(url).toBe("https://web.example.com/share/tier-lists/a%2Fb%3Fc");
  });

  it("webBaseUrl 末尾のスラッシュは取り除く", () => {
    const url = buildTierListShareUrl("tok", "https://web.example.com/");
    expect(url).toBe("https://web.example.com/share/tier-lists/tok");
  });
});
