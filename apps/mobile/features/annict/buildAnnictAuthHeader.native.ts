import { annictTokenStorage } from "./storage";

/**
 * 記録系 API 呼び出しに付ける Annict 認可ヘッダ。
 * ネイティブは SecureStore のトークンを X-Annict-Token で運ぶ。未連携なら空。
 */
export async function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  const token = await annictTokenStorage.get();
  return token ? { "X-Annict-Token": token } : {};
}
