import { colors } from "./colors";

// WCAG 2.x の相対輝度・コントラスト比計算（テスト専用ヘルパー）。
// https://www.w3.org/TR/WCAG/#dfn-relative-luminance
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (l1 + 0.05) / (l2 + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe("contrastRatio ヘルパー自身の検証", () => {
  it("黒と白で 21:1 を返す", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("colors.light.placeholder のコントラスト (WCAG AA)", () => {
  // 実際に Input を置いている背景色すべてを網羅する。
  // 新しい背景色の入力欄を追加したらここにも列挙する。
  it.each([
    ["白背景 (サインイン/サインアップ/検索バー/シート等)", "#ffffff"],
    ["gray-50 背景 (プロフィール画面)", "#f9fafb"],
    ["gray-100 背景 (お気に入り検索欄)", "#f3f4f6"],
  ])("%s 上で 4.5:1 以上", (_label, background) => {
    expect(
      contrastRatio(colors.light.placeholder, background),
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});

describe("colors.dark.placeholder のコントラスト (WCAG AA)", () => {
  // dark で入力欄を置いている背景色すべてを網羅する（dark: クラス側と同じ slate 値）。
  it.each([
    ["画面ベース背景 (dark:bg-slate-900)", "#0f172a"],
    ["カード/シート面 (dark:bg-slate-800)", "#1e293b"],
    ["チップ/入力枠 (dark:bg-slate-700)", "#334155"],
  ])("%s 上で 4.5:1 以上", (_label, background) => {
    expect(
      contrastRatio(colors.dark.placeholder, background),
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});

describe("スキーム間のトークン対応", () => {
  it("light と dark が同じセマンティックキーを持つ", () => {
    // 片方にだけ存在するトークンは片側スキームで未定義色になるため、
    // キー集合の一致をテストで担保する。
    expect(Object.keys(colors.dark).sort()).toEqual(
      Object.keys(colors.light).sort(),
    );
  });
});
