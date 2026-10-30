import { describe, it, expect } from "vitest";
import { buildWorkListShareUrl } from "./shareUrl";

describe("buildWorkListShareUrl", () => {
  it("API の共有エンドポイントを指す URL を組み立てる", () => {
    expect(buildWorkListShareUrl("tok-123", "https://api.example.com")).toBe(
      "https://api.example.com/share/work-lists/tok-123",
    );
  });

  it("末尾スラッシュの重複を避け、トークンはエンコードする", () => {
    expect(buildWorkListShareUrl("a/b?c", "https://api.example.com/")).toBe(
      "https://api.example.com/share/work-lists/a%2Fb%3Fc",
    );
  });
});
