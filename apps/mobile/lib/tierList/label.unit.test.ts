import { describe, expect, it } from "vitest";
import {
  TIER_LABEL_MAX_LENGTH,
  renameTier,
  tierLabelError,
  tierLabelFontSize,
  tierLabelTextColor,
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

  it("trim 後に同じ名前なら同じ配列を返す（未保存扱いにしないための判定用）", () => {
    expect(renameTier(TIERS, "0", "S")).toBe(TIERS);
    expect(renameTier(TIERS, "0", "  S  ")).toBe(TIERS);
  });

  it("存在しない key を指定しても同じ配列を返す", () => {
    expect(renameTier(TIERS, "zzz", "X")).toBe(TIERS);
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

describe("tierLabelTextColor", () => {
  // 既定 tier 色（lib/tierList/defaults.ts の DEFAULT_TIERS）を網羅する。
  it("暗い背景色には白を返す", () => {
    expect(tierLabelTextColor("#ff0000")).toBe("#ffffff"); // S（赤）
    expect(tierLabelTextColor("#0000ff")).toBe("#ffffff"); // D（青）
  });

  it("明るい背景色には濃色を返す", () => {
    expect(tierLabelTextColor("#ff8000")).toBe("#1f2937"); // A（橙）
    expect(tierLabelTextColor("#ffff00")).toBe("#1f2937"); // B（黄）
    expect(tierLabelTextColor("#00ff00")).toBe("#1f2937"); // C（緑）
  });

  it("パース不能な色は濃色に倒す（従来の固定色と同じ既定）", () => {
    expect(tierLabelTextColor("red")).toBe("#1f2937");
    expect(tierLabelTextColor("")).toBe("#1f2937");
    expect(tierLabelTextColor("#fff")).toBe("#1f2937");
  });
});
