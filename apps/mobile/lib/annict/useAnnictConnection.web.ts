import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
import { type UseAnnictConnection } from "./useAnnictConnection";

/**
 * Annict 連携済みかどうかをサーバーに問い合わせて返す（Web）。
 *
 * Web はトークンをサーバー(D1)に暗号化保存するため、SecureStore を見ず
 * `GET /me/annict` の connected を判定に使う。Clerk 認証が前提。
 */
export function useAnnictConnection(): UseAnnictConnection {
  const { getToken, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: ANNICT_CONNECTION_QUERY_KEY,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const clerkToken = await getToken();
      if (!clerkToken) return { connected: false };
      const res = await apiClient.me.annict.$get(
        {},
        { headers: { Authorization: `Bearer ${clerkToken}` } },
      );
      if (!res.ok) return { connected: false };
      const body = (await res.json()) as { connected: boolean };
      return { connected: body.connected };
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
 * Web はサーバーが Clerk 認証で D1 のトークンを参照するため、ヘッダは付けない。
 */
export async function buildAnnictAuthHeader(): Promise<Record<string, string>> {
  return {};
}
