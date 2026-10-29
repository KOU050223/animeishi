import { describe, expect, it } from "vitest";
import { buildCustomTierListShareUrl, buildTierListShareUrl } from "./shareUrl";

describe("buildTierListShareUrl", () => {
  it("API の共有エンドポイント形式の URL を組み立てる", () => {
    const url = buildTierListShareUrl("abc-123", "https://api.example.com");
    expect(url).toBe("https://api.example.com/share/tier-lists/abc-123");
  });

  it("トークンは URL エンコードされる", () => {
    const url = buildTierListShareUrl("a/b?c", "https://api.example.com");
    expect(url).toContain(encodeURIComponent("a/b?c"));
  });
});

describe("buildCustomTierListShareUrl", () => {
  it("自由作成 tier 表の共有エンドポイント形式の URL を組み立てる", () => {
    const url = buildCustomTierListShareUrl(
      "abc-123",
      "https://api.example.com",
    );
    expect(url).toBe("https://api.example.com/share/custom-tier-lists/abc-123");
  });

  it("トークンは URL エンコードされる", () => {
    const url = buildCustomTierListShareUrl("a/b?c", "https://api.example.com");
    expect(url).toContain(encodeURIComponent("a/b?c"));
  });
});
