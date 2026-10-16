import type { TierRow } from "./types";

/**
 * tier 名（ラベル）の編集に関する純粋関数群。
 * サーバの zod（tiers[].label）と同じ制約を UI 側でも先に検査し、
 * 保存ボタンを押す前に不正な入力へフィードバックする。
 */

/** tier 名の文字数上限。サーバの tierRowSchema.label max(24) と揃える。 */
export const TIER_LABEL_MAX_LENGTH = 24;

/**
 * tier 名のバリデーション。問題なければ null、あればエラーメッセージを返す。
 * サーバは trim 後の文字列に min(1) / max(24) を課すため、ここでも
 * trim 後の長さで判定する（両端の空白は送信時に落ちる前提）。
 */
export function tierLabelError(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length === 0) return "tier 名を入力してください";
  if (trimmed.length > TIER_LABEL_MAX_LENGTH) {
    return `tier 名は${TIER_LABEL_MAX_LENGTH}文字以内で入力してください`;
  }
  return null;
}

/**
 * 指定 tier のラベルを差し替えた新しい tiers を返す。
 * key は配置（assignment / items.tierKey）からの参照識別子なので変えず、
 * label だけを更新する。送信時にサーバが trim するため、ここでも trim 済みの
 * 値を保持して見た目と保存内容を一致させる。
 * 差分が無い（trim 後に同じ名前、または存在しない key）ときは同じ配列を
 * そのまま返す。呼び出し側は `next === tiers` で変更有無を判定でき、
 * 未保存フラグを誤って立てずに済む。
 */
export function renameTier(
  tiers: TierRow[],
  tierKey: string,
  label: string,
): TierRow[] {
  const trimmed = label.trim();
  const target = tiers.find((tier) => tier.key === tierKey);
  if (!target || target.label === trimmed) return tiers;
  return tiers.map((tier) =>
    tier.key === tierKey ? { ...tier, label: trimmed } : tier,
  );
}

/**
 * 長い tier 名をラベルセルに収めるためのフォントサイズ調整。
 * セル幅は固定なので、文字数に応じて段階的に縮小する
 * （numberOfLines による切り詰めは残る。全表示は行を過度に伸ばすため）。
 * zod の文字数判定（UTF-16 コードユニット）に合わせて .length を使う。
 */
export function tierLabelFontSize(label: string, baseSize: number): number {
  const len = label.length;
  if (len <= 4) return baseSize;
  if (len <= 12) return Math.max(10, Math.round(baseSize * 0.8));
  return Math.max(8, Math.round(baseSize * 0.6));
}

/** ラベル文字色の候補。濃色は slate-900 系、淡色は白。 */
const TIER_LABEL_TEXT_DARK = "#1f2937";
const TIER_LABEL_TEXT_LIGHT = "#ffffff";

// WCAG 2.x の相対輝度。tier.color は #RRGGBB 固定（サーバの tierRowSchema
// と同じ形式）なので、それ以外はパース不能として null を返す。
// https://www.w3.org/TR/WCAG/#dfn-relative-luminance
function relativeLuminance(color: string): number | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match || !match[1]) return null;
  const n = parseInt(match[1], 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * tier ラベルセルの文字色。tier.color はユーザーが自由に変えられるため、
 * 背景色とのコントラストが高い側を濃色/白から選ぶ。
 * 固定の濃色では既定 D 行の #0000ff の上で読めず、固定の白では
 * B 行の #ffff00 の上で読めないため。スキームによらず同じ判定でよい
 * （背景色はスキームに追従しない）。
 * パース不能な色は従来通り濃色に倒す。
 */
export function tierLabelTextColor(backgroundColor: string): string {
  const bg = relativeLuminance(backgroundColor);
  if (bg === null) return TIER_LABEL_TEXT_DARK;
  const dark = relativeLuminance(TIER_LABEL_TEXT_DARK) ?? 0;
  return contrastRatio(bg, dark) >= contrastRatio(bg, 1)
    ? TIER_LABEL_TEXT_DARK
    : TIER_LABEL_TEXT_LIGHT;
}
