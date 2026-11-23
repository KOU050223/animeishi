import { describe, expect, it } from "vitest";
import { colors } from "./colors";
import type { ThemeColors } from "./colors";

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
const WCAG_AA_UI = 3;

describe("contrastRatio ヘルパー自身の検証", () => {
  it("黒と白で 21:1 を返す", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

// 実際に画面で使われている前景×背景の組み合わせと下限（issue #723）。
// 本文・小さい補助文字は AA の 4.5:1。大きい文字（18pt 以上 / 14pt 以上の
// 太字）、意味を持つアイコン、UI 部品の境界は 3:1。無効状態は WCAG 上
// 免除されるが、有効状態と見分けが付く最低限として 3:1 で固定する。
// border / borderMuted / scrim は装飾的な区切り・暗幕で、部品の識別に
// 必須な前景を運ばないため対象外（選択枠など識別用途は primaryBorder
// 側の組み合わせで担保する）。
// className 直書きの組み合わせはこのテストの対象外。トークン値と同じ
// Tailwind 値を使っている限り同じ比率になるが、独自の組み合わせは別途
// 監査が必要。
type Combo = { usage: string; fg: string; bg: string; min: number };

function combos(c: ThemeColors, disabledSurface: string): Combo[] {
  return [
    // 本文・見出し
    {
      usage: "本文・見出し: 画面背景",
      fg: c.text,
      bg: c.background,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "本文・見出し: 薄い下地 (backgroundMuted)",
      fg: c.text,
      bg: c.backgroundMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "本文・見出し: カード/シート (surface)",
      fg: c.text,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "本文・見出し: チップ/控えめボタン面 (surfaceMuted)",
      fg: c.text,
      bg: c.surfaceMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "本文・見出し: tier ドロップ領域上の作品タイトル",
      fg: c.text,
      bg: c.tierDropArea,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "本文・見出し: tier カードのタイトル帯",
      fg: c.text,
      bg: c.tierCardLabel,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // 副テキスト
    {
      usage: "副テキスト: 画面背景",
      fg: c.textSecondary,
      bg: c.background,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "副テキスト: 薄い下地 (backgroundMuted)",
      fg: c.textSecondary,
      bg: c.backgroundMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "副テキスト: カード/シート (surface)",
      fg: c.textSecondary,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "副テキスト: トレイ空表示 (tierDropArea)",
      fg: c.textSecondary,
      bg: c.tierDropArea,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "副テキスト: 「画像なし」カード面 (tierCardFallback)",
      fg: c.textSecondary,
      bg: c.tierCardFallback,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // 補助テキスト（本文として使う場面）
    {
      usage: "補助テキスト: 画面背景 (タブ未選択・空状態)",
      fg: c.textMuted,
      bg: c.background,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "補助テキスト: 薄い下地 (backgroundMuted)",
      fg: c.textMuted,
      bg: c.backgroundMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "補助テキスト: カード/シート (surface)",
      fg: c.textMuted,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // 補助アイコン・無効状態（意味を持つ図形/UI 部品として 3:1）
    {
      usage: "補助アイコン・無効ボタン: チップ面 (surfaceMuted)",
      fg: c.textMuted,
      bg: c.surfaceMuted,
      min: WCAG_AA_UI,
    },
    {
      usage: "無効ボタン: ラベル/アイコン",
      fg: c.textMuted,
      bg: disabledSurface,
      min: WCAG_AA_UI,
    },
    // 強調・リンク文字
    {
      usage: "強調文字: 画面背景 (タブ選択中・リンク)",
      fg: c.primaryText,
      bg: c.background,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "強調文字: 薄い下地 (backgroundMuted)",
      fg: c.primaryText,
      bg: c.backgroundMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "強調文字: カード/シート (surface)",
      fg: c.primaryText,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "強調文字: プライマリ面 (NowWatchingBubble)",
      fg: c.primaryText,
      bg: c.primarySoft,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // プライマリ塗り上の文字
    {
      usage: "ボタン文字: primary 塗り",
      fg: c.onPrimary,
      bg: c.primary,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "ボタン文字: 共有ボタンの violet 塗り",
      fg: c.onPrimary,
      bg: "#7c3aed",
      min: WCAG_AA_NORMAL_TEXT,
    },
    // エラー・危険操作
    {
      usage: "エラー文字: カード/シート (surface)",
      fg: c.danger,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "エラー文字: チップ面 (プロパティパネルの危険ボタン)",
      fg: c.danger,
      bg: c.surfaceMuted,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // 成功表示
    {
      usage: "成功表示: 画面背景",
      fg: c.success,
      bg: c.background,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "成功表示: カード/シート (surface)",
      fg: c.success,
      bg: c.surface,
      min: WCAG_AA_NORMAL_TEXT,
    },
    {
      usage: "成功文字: 成功面 (successSoft)",
      fg: c.successText,
      bg: c.successSoft,
      min: WCAG_AA_NORMAL_TEXT,
    },
    // UI 部品の境界（選択枠・吹き出し輪郭）
    {
      usage: "選択枠・吹き出し輪郭: 画面背景",
      fg: c.primaryBorder,
      bg: c.background,
      min: WCAG_AA_UI,
    },
    {
      usage: "選択枠: カード/シート (surface)",
      fg: c.primaryBorder,
      bg: c.surface,
      min: WCAG_AA_UI,
    },
    {
      usage: "選択枠: チップ面 (surfaceMuted)",
      fg: c.primaryBorder,
      bg: c.surfaceMuted,
      min: WCAG_AA_UI,
    },
    {
      usage: "吹き出し輪郭: プライマリ面 (primarySoft)",
      fg: c.primaryBorder,
      bg: c.primarySoft,
      min: WCAG_AA_UI,
    },
  ];
}

describe.each([
  // 無効ボタンの面はスキームで違う（bg-slate-200 / bg-slate-700）。
  // dark 側は surfaceMuted と同値なのでトークンを参照する。
  ["light", colors.light, "#e2e8f0"],
  ["dark", colors.dark, colors.dark.surfaceMuted],
])("colors.%s の前景×背景 (WCAG AA)", (_scheme, c, disabledSurface) => {
  it.each(combos(c, disabledSurface))(
    "$usage で $min:1 以上",
    ({ fg, bg, min }) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
    },
  );
});

describe("colors.light.placeholder のコントラスト (WCAG AA)", () => {
  // 実際に Input を置いている背景色すべてを網羅する。
  // 新しい背景色の入力欄を追加したらここにも列挙する。
  it.each([
    ["白背景 (サインイン/サインアップ/検索バー/シート等)", "#ffffff"],
    ["slate-50 背景 (プロフィール画面)", "#f8fafc"],
    ["slate-100 背景 (お気に入り検索欄)", "#f1f5f9"],
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
