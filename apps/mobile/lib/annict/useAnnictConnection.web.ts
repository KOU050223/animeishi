import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch, clerkSessionToken } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { ANNICT_CONNECTION_QUERY_KEY } from "./connectionKey";
import { type UseAnnictConnection } from "./useAnnictConnection";

/**
 * Annict 連携済みかどうかをサーバーに問い合わせて返す（Web）。
 *
 * Web はトークンをサーバー(D1)に暗号化保存するため、SecureStore を見ず
 * `GET /me/annict` の connected を判定に使う。Clerk 認証が前提。
 */
export function useAnnictConnection(): UseAnnictConnection {
  const { isLoaded, isSignedIn, userId } = useAuth();

  const query = useQuery({
    // userId を含めて別ユーザーとキャッシュを分離する。同一ブラウザで別アカウントに
    // 切り替えたとき、前ユーザーの connected=true が再利用されるのを防ぐ。
    queryKey: [...ANNICT_CONNECTION_QUERY_KEY, userId],
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const clerkToken = await clerkSessionToken();
      if (!clerkToken) return { connected: false };
      try {
        const res = await apiClient.me.annict.$get(
          {},
          {
            fetch: apiFetch({
              // HTTP 失敗は「未連携」として返す契約のため ApiRequestError
              // で判別する。ネットワーク不通などは従来どおりクエリの
              // エラーとして扱う。
              onHttpError: async (errorRes) =>
                new ApiRequestError(errorRes.status, "annict status failed"),
            }),
          },
        );
        const body = (await res.json()) as { connected: boolean };
        return { connected: body.connected };
      } catch (error) {
        if (error instanceof ApiRequestError) return { connected: false };
        throw error;
      }
    },
  });

  return {
    // サインイン中かつクエリが connected を返したときだけ true。
    isConnected: (!!isSignedIn && query.data?.connected) ?? false,
    // Clerk のセッション復元中（isLoaded=false）はクエリが disabled で
    // query.isLoading が立たない。連携状態が未確定の間もロード中として返し、
    // 呼び出し側が「未連携」と誤表示しないようにする。
    isLoading: !isLoaded || query.isLoading,
    refetch: query.refetch,
  };
}
