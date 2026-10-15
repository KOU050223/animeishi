import { describe, it, expect } from "vitest";
import { tierListSaveSchema } from "./schema";

describe("tierListSaveSchema", () => {
  const baseInput = {
    season: "2026-spring",
    title: "2026年春アニメ Tier",
    tiers: [
      { key: "0", label: "S", color: "#ff0000" },
      { key: "1", label: "A", color: "#ff8000" },
    ],
    items: [{ annictWorkId: 1, tierKey: "0" }],
  };

  it("自由記述の tier 名を受け入れる", () => {
    expect(
      tierListSaveSchema.safeParse({
        ...baseInput,
        tiers: [
          { key: "0", label: "神", color: "#ff0000" },
          { key: "1", label: "また見たい", color: "#ff8000" },
        ],
      }).success,
    ).toBe(true);
  });

  it("空文字・空白のみの tier 名は拒否する", () => {
    for (const label of ["", "   "]) {
      expect(
        tierListSaveSchema.safeParse({
          ...baseInput,
          tiers: [{ key: "0", label, color: "#ff0000" }],
          items: [],
        }).success,
      ).toBe(false);
    }
  });

  it("24 文字を超える tier 名は拒否する（trim 後の長さで判定）", () => {
    expect(
      tierListSaveSchema.safeParse({
        ...baseInput,
        tiers: [{ key: "0", label: "あ".repeat(25), color: "#ff0000" }],
        items: [],
      }).success,
    ).toBe(false);
  });

  it("両端の空白を trim した長さで上限を判定する", () => {
    expect(
      tierListSaveSchema.safeParse({
        ...baseInput,
        tiers: [
          { key: "0", label: `  ${"あ".repeat(24)}  `, color: "#ff0000" },
        ],
        items: [],
      }).success,
    ).toBe(true);
  });
});
