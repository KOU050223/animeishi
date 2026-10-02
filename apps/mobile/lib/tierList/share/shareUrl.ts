import { apiUrl } from "@/lib/apiUrl";

/**
 * 共有トークンから公開ページの URL を組み立てる。
 * API が静的 HTML（OGP 付き）を返すエンドポイントを指すため、
 * SNS に貼っても展開される。Web フロント経由ではない点に注意。
 */
export function buildTierListShareUrl(shareToken: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/share/tier-lists/${encodeURIComponent(shareToken)}`;
}
