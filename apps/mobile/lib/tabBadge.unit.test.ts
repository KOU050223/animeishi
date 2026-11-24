import { describe, expect, it } from "vitest";
import { tabBadgeText } from "./tabBadge";

describe("tabBadgeText", () => {
  it("1 件以上なら件数を文字列で返す", () => {
    expect(tabBadgeText(1)).toBe("1");
    expect(tabBadgeText(12)).toBe("12");
  });

  it("0 件ならバッジを出さないよう undefined を返す", () => {
    expect(tabBadgeText(0)).toBeUndefined();
  });

  it("負の値もバッジを出さない", () => {
    expect(tabBadgeText(-1)).toBeUndefined();
  });
});
