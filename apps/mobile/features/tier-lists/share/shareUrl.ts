/**
 * 共有トークンから公開ページの URL を組み立てる。
 * URL は Web ドメイン（animeishi.uomi.dev）を指し、Web Worker が
 * /share/* を API へ転送して OGP 付きの静的 HTML を返す（issue #408）。
 * webBaseUrl には webUrl（@/lib/webUrl）を渡す。引数にしているのは、
 * expo-constants への依存をこの純関数から切り離すため。
 * kind を問わず /share/tier-lists/:token に一本化（issue #724）。
 */
export function buildTierListShareUrl(
  shareToken: string,
  webBaseUrl: string,
): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/share/tier-lists/${encodeURIComponent(shareToken)}`;
}
