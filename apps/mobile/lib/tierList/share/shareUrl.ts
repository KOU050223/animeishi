/**
 * 共有トークンから公開ページの URL を組み立てる。
 * URL は Web ドメイン（animeishi.uomi.dev）を指し、Web Worker が
 * /share/* を API へ転送して OGP 付きの静的 HTML を返す（issue #408）。
 * webBaseUrl には webUrl（@/lib/webUrl）を渡す。引数にしているのは、
 * expo-constants への依存をこの純関数から切り離すため。
 */
export function buildTierListShareUrl(
  shareToken: string,
  webBaseUrl: string,
): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/share/tier-lists/${encodeURIComponent(shareToken)}`;
}

/** キャラクター tier 表の共有 URL（issue #169）。エンドポイントだけが違う。 */
export function buildCharacterTierListShareUrl(
  shareToken: string,
  webBaseUrl: string,
): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/share/character-tier-lists/${encodeURIComponent(shareToken)}`;
}

/** 自由作成 tier 表の共有 URL（issue #348）。エンドポイントだけが違う。 */
export function buildCustomTierListShareUrl(
  shareToken: string,
  webBaseUrl: string,
): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/share/custom-tier-lists/${encodeURIComponent(shareToken)}`;
}
