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
