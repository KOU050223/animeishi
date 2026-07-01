import { useQuery } from "@tanstack/react-query";
import { annictTokenStorage } from "./storage";
import { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
import { type UseAnnictConnection } from "./useAnnictConnection";

/**
 * Annict 連携済みかどうか（SecureStore のトークン有無）を返す。
 *
 * 設計（docs/05）: ネイティブはサーバーにトークンを保存せず、連携済み判定は
 * クライアントの SecureStore のトークン有無で行う。ソフトゲートの分岐に使う。
 * トークンの実値は返さず、有無（boolean）だけを公開する。
 */
export function useAnnictConnection(): UseAnnictConnection {
  const query = useQuery({
    queryKey: ANNICT_CONNECTION_QUERY_KEY,
    queryFn: async () => {
      const token = await annictTokenStorage.get();
      return { connected: token != null };
    },
  });

  return {
    isConnected: query.data?.connected ?? false,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * 記録系 API 呼び出しに付ける Annict 認可ヘッダ。
 * ネイティブは SecureStore のトークンを X-Annict-Token で運ぶ。未連携なら空。
 */
export async function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  const token = await annictTokenStorage.get();
  return token ? { "X-Annict-Token": token } : {};
}
