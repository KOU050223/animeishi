import { DEFAULT_TIERS, defaultTierListTitle } from "./defaults";

describe("DEFAULT_TIERS", () => {
  it("key が重複していない（重複するとサーバの検証で 400 になる）", () => {
    const keys = DEFAULT_TIERS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("色が #RRGGBB 形式（サーバの zod がこの形式のみ受け付ける）", () => {
    for (const tier of DEFAULT_TIERS) {
      expect(tier.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("行数がサーバの上限（12 行）以内", () => {
    expect(DEFAULT_TIERS.length).toBeGreaterThan(0);
    expect(DEFAULT_TIERS.length).toBeLessThanOrEqual(12);
  });

  it("ラベルがサーバの上限（24 文字）以内", () => {
    for (const tier of DEFAULT_TIERS) {
      expect(tier.label.length).toBeGreaterThan(0);
      expect(tier.label.length).toBeLessThanOrEqual(24);
    }
  });
});

describe("defaultTierListTitle", () => {
  it("シーズン文字列から日本語のタイトルを組み立てる", () => {
    expect(defaultTierListTitle("2026-spring")).toBe("2026年春アニメ Tier");
    expect(defaultTierListTitle("2025-autumn")).toBe("2025年秋アニメ Tier");
  });

  it("サーバの上限（50 文字）を超えない", () => {
    expect(defaultTierListTitle("2026-winter").length).toBeLessThanOrEqual(50);
  });
});
