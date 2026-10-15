import {
  DEFAULT_TIERS,
  defaultTierListTitle,
  defaultCharacterTierListTitle,
} from "./defaults";

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

describe("defaultCharacterTierListTitle", () => {
  it("作品タイトルから既定タイトルを組み立てる", () => {
    expect(defaultCharacterTierListTitle("青春ブタ野郎")).toBe(
      "青春ブタ野郎 キャラクターTier",
    );
  });

  it("作品タイトルが無ければ汎用の名前を返す", () => {
    expect(defaultCharacterTierListTitle(null)).toBe("キャラクター Tier 表");
    expect(defaultCharacterTierListTitle()).toBe("キャラクター Tier 表");
  });

  it("長い作品タイトルでもサーバの上限（50 文字）を超えない", () => {
    // 上限超過のまま保存すると常に 400 になり、タイトル編集 UI がないため
    // ユーザーが回復できない。既定タイトルは必ず 50 文字以内に収める。
    expect(
      defaultCharacterTierListTitle("あ".repeat(60)).length,
    ).toBeLessThanOrEqual(50);
  });
});
