import {
  TIER_LABEL_MAX_LENGTH,
  renameTier,
  tierLabelError,
  tierLabelFontSize,
} from "./label";
import type { TierRow } from "./types";

const TIERS: TierRow[] = [
  { key: "0", label: "S", color: "#ff0000" },
  { key: "1", label: "A", color: "#ff8000" },
];

describe("tierLabelError", () => {
  it("有効なラベルは null を返す", () => {
    expect(tierLabelError("神")).toBeNull();
    expect(tierLabelError("あ".repeat(TIER_LABEL_MAX_LENGTH))).toBeNull();
  });

  it("空文字・空白のみはエラーになる（サーバは trim 後に min(1) を課す）", () => {
    expect(tierLabelError("")).not.toBeNull();
    expect(tierLabelError("   ")).not.toBeNull();
  });

  it("上限（24 文字）を超えるとエラーになる", () => {
    expect(
      tierLabelError("あ".repeat(TIER_LABEL_MAX_LENGTH + 1)),
    ).not.toBeNull();
  });

  it("両端の空白は trim してから数える", () => {
    expect(
      tierLabelError(`  ${"あ".repeat(TIER_LABEL_MAX_LENGTH)}  `),
    ).toBeNull();
    expect(
      tierLabelError(`  ${"あ".repeat(TIER_LABEL_MAX_LENGTH + 1)}  `),
    ).not.toBeNull();
  });
});

describe("renameTier", () => {
  it("指定 key のラベルだけを差し替える", () => {
    const next = renameTier(TIERS, "0", "神");
    expect(next[0]).toEqual({ key: "0", label: "神", color: "#ff0000" });
    expect(next[1]).toEqual(TIERS[1]);
  });

  it("入力値を trim して保存する（サーバの trim と見た目を一致させる）", () => {
    const next = renameTier(TIERS, "1", "  最強  ");
    expect(next[1].label).toBe("最強");
  });

  it("key は変えない（配置からの参照が壊れないように）", () => {
    const next = renameTier(TIERS, "0", "SSS");
    expect(next[0].key).toBe("0");
  });

  it("存在しない key を指定しても何も変わらない", () => {
    expect(renameTier(TIERS, "zzz", "X")).toEqual(TIERS);
  });

  it("元の配列を破壊しない", () => {
    renameTier(TIERS, "0", "神");
    expect(TIERS[0].label).toBe("S");
  });
});

describe("tierLabelFontSize", () => {
  it("短いラベルはベースサイズのまま", () => {
    expect(tierLabelFontSize("S", 13)).toBe(13);
    expect(tierLabelFontSize("ああああ", 13)).toBe(13);
  });

  it("中程度の長さは縮小する", () => {
    expect(tierLabelFontSize("あ".repeat(5), 13)).toBeLessThan(13);
    expect(tierLabelFontSize("あ".repeat(12), 13)).toBeLessThan(13);
    expect(tierLabelFontSize("あ".repeat(12), 13)).toBeGreaterThanOrEqual(10);
  });

  it("長いラベルはさらに縮小するが下限を割らない", () => {
    expect(tierLabelFontSize("あ".repeat(13), 13)).toBeLessThan(
      tierLabelFontSize("あ".repeat(12), 13),
    );
    expect(tierLabelFontSize("あ".repeat(24), 13)).toBeGreaterThanOrEqual(8);
  });
});
