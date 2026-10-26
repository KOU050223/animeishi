// CORS の許可オリジン判定。
//
// ALLOWED_ORIGINS はカンマ区切りのオリジンリスト。各エントリは次の 2 形式を取れる:
//   - 完全一致:     "https://animeishi.uomi.dev"
//   - ワイルドカード: "*-animeishi-web-production.uozumi05.workers.dev"
//                     先頭 "*" を任意文字列として、残りのサフィックスに endsWith で一致させる。
//                     Cloudflare のプレビューデプロイ（<hash>-<worker>.<subdomain>.workers.dev）を許可する用途。
//
// 未設定（空リスト）の場合は開発利便のため全オリジンを許可する。

/** ALLOWED_ORIGINS 文字列をエントリ配列へパースする。空白除去・空要素除去のみ行う。 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * リクエストの Origin が許可リストに一致するか判定する。
 * @returns 許可するオリジン文字列（cors の origin にそのまま返す）。不許可なら null。
 */
export function resolveAllowedOrigin(
  origin: string,
  allowlist: string[],
): string | null {
  // 未設定なら全許可（開発用）。
  if (allowlist.length === 0) return origin;

  for (const entry of allowlist) {
    if (entry.startsWith("*")) {
      // 先頭 "*" を除いたサフィックスで末尾一致を見る。
      const suffix = entry.slice(1);
      if (origin.endsWith(suffix)) return origin;
    } else if (entry === origin) {
      return origin;
    }
  }

  return null;
}
