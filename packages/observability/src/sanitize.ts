// Sentry など外部サービスへ送る前に除去するヘッダ名（小文字で保持）。
export const SENSITIVE_HEADERS: readonly string[] = [
  "authorization",
  "x-annict-token",
  "cookie",
  "set-cookie",
];

const FILTERED = "[Filtered]";

// ヘッダ名→値のレコードから、秘匿ヘッダの値を "[Filtered]" に置き換える。
// キーの表記（大文字小文字）は元のまま残す。
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.includes(key.toLowerCase()) ? FILTERED : value;
  }
  return out;
}
