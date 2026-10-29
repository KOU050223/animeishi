/**
 * 共有トークンから公開ページの URL を組み立てる。
 * API が静的 HTML（OGP 付き）を返すエンドポイントを指すため、
 * SNS に貼っても展開される。Web フロント経由ではない点に注意。
 * apiBaseUrl には apiUrl（@/lib/apiUrl）を渡す。引数にしているのは、
 * expo-constants への依存をこの純関数から切り離すため。
 */
export function buildTierListShareUrl(
  shareToken: string,
  apiBaseUrl: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/share/tier-lists/${encodeURIComponent(shareToken)}`;
}

/** キャラクター tier 表の共有 URL（issue #169）。エンドポイントだけが違う。 */
export function buildCharacterTierListShareUrl(
  shareToken: string,
  apiBaseUrl: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/share/character-tier-lists/${encodeURIComponent(shareToken)}`;
}

/** 自由作成 tier 表の共有 URL（issue #348）。エンドポイントだけが違う。 */
export function buildCustomTierListShareUrl(
  shareToken: string,
  apiBaseUrl: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/share/custom-tier-lists/${encodeURIComponent(shareToken)}`;
}
