import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { watchHistoryQueries } from "@/lib/queries/watchHistories";

/**
 * 共有トークンから視聴履歴の公開ページ URL を組み立てる。
 * URL は Web ドメイン（animeishi.uomi.dev）を指し、Web Worker が
 * /share/* を API へ転送して Markdown / 素の HTML を返すため、AI に
 * そのまま渡せる（issue #236、#408）。
 * webBaseUrl には webUrl（@/lib/webUrl）を渡す。
 * 引数にしているのは、expo-constants への依存をこの純関数から切り離すため。
 */
export function buildWatchHistoryShareUrl(
  shareToken: string,
  webBaseUrl: string,
): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/share/watch-history/${encodeURIComponent(shareToken)}`;
}

/** 発行中の共有トークンを取得する。未発行なら shareToken は null。 */
export function useWatchHistoryShareStatus() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...watchHistoryQueries.share.status.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 視聴履歴の共有トークンを発行する。トークンは冪等
 * （既に発行済みなら同じトークンが返る）。
 */
export function useShareWatchHistory() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.me["watch-histories"].share.$post(
        {},
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの発行に失敗しました",
          }),
        },
      );
      // apiFetch が !ok を排除済みなので、res.json() の union から
      // 成功型に絞る。
      return res.json() as Promise<{ shareToken: string }>;
    },
    onSuccess: (data) => {
      if (!userId) return;
      queryClient.setQueryData(watchHistoryQueries.share.key(userId), {
        shareToken: data.shareToken,
      });
    },
  });
}

/** 共有トークンを破棄する。破棄後は共有 URL が 404 を返す。 */
export function useUnshareWatchHistory() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.me["watch-histories"].share.$delete(
        {},
        {
          fetch: apiFetch({
            errorMessage: "共有リンクの解除に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      if (!userId) return;
      queryClient.setQueryData(watchHistoryQueries.share.key(userId), {
        shareToken: null,
      });
    },
  });
}
