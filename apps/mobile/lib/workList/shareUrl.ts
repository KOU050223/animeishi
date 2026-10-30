/**
 * 作品リストの共有トークンから公開ページの URL を組み立てる（issue #349）。
 * API が静的 HTML（OGP 付き）を返すエンドポイントを指すため、
 * SNS に貼っても展開される。Web フロント経由ではない点に注意。
 * apiBaseUrl には apiUrl（@/lib/apiUrl）を渡す。引数にしているのは、
 * expo-constants への依存をこの純関数から切り離すため。
 * （lib/tierList/share/shareUrl.ts と同じ方式。エンドポイントだけが違う。）
 */
export function buildWorkListShareUrl(
  shareToken: string,
  apiBaseUrl: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/share/work-lists/${encodeURIComponent(shareToken)}`;
}
