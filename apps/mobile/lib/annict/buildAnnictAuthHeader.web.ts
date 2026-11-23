/**
 * 記録系 API 呼び出しに付ける Annict 認可ヘッダ。
 * Web はサーバーが Clerk 認証で D1 のトークンを参照するため、ヘッダは付けない。
 */
export async function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  return {};
}
