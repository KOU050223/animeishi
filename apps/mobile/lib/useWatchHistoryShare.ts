import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

const watchHistoryShareQueryKey = ["watch-history-share"] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 共有トークンから視聴履歴の公開ページ URL を組み立てる。
 * API が Markdown / 素の HTML を返すエンドポイントを指すため、AI に
 * そのまま渡せる（issue #236）。apiBaseUrl には apiUrl（@/lib/apiUrl）を渡す。
 * 引数にしているのは、expo-constants への依存をこの純関数から切り離すため。
 */
export function buildWatchHistoryShareUrl(
  shareToken: string,
  apiBaseUrl: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/share/watch-history/${encodeURIComponent(shareToken)}`;
}

/** 発行中の共有トークンを取得する。未発行なら shareToken は null。 */
export function useWatchHistoryShareStatus() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: watchHistoryShareQueryKey,
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"].share.$get(
        {},
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの取得に失敗しました");
      }
      return res.json();
    },
  });
}

/**
 * 視聴履歴の共有トークンを発行する。トークンは冪等
 * （既に発行済みなら同じトークンが返る）。
 */
export function useShareWatchHistory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"].share.$post(
        {},
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの発行に失敗しました");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(watchHistoryShareQueryKey, {
        shareToken: data.shareToken,
      });
    },
  });
}

/** 共有トークンを破棄する。破棄後は共有 URL が 404 を返す。 */
export function useUnshareWatchHistory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me["watch-histories"].share.$delete(
        {},
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "共有リンクの解除に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(watchHistoryShareQueryKey, {
        shareToken: null,
      });
    },
  });
}
