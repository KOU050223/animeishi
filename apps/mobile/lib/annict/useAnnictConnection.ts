import { useQuery } from "@tanstack/react-query";
import { annictTokenStorage } from "./storage";

export const ANNICT_CONNECTION_QUERY_KEY = ["annict-connection"] as const;

/**
 * Annict 連携済みかどうか（SecureStore のトークン有無）を返す。
 *
 * 設計（docs/05）: サーバーはトークンを保存しないため、連携済み判定は
 * クライアントの SecureStore のトークン有無で行う。ソフトゲートの分岐に使う。
 * トークンの実値は返さず、有無（boolean）だけを公開する。
 */
export function useAnnictConnection() {
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

/** X-Annict-Token ヘッダを付与するためにトークンを取得する。未連携なら null。 */
export function getAnnictToken(): Promise<string | null> {
  return annictTokenStorage.get();
}
