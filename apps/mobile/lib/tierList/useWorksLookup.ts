import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";

/**
 * 作品 ID のまとめ解決（GET /works/lookup）。
 *
 * 自由作成 tier 表（issue #348）の作成画面が、ルートパラメータで引き継いだ
 * 初期作品 ID（issue #349 の作品リストからの受け渡し）のメタを解決するのに
 * 使う。検索済みの作品は API 側のキャッシュ（annict_works）で返り、
 * 無いものだけ Annict に問い合わせる。
 *
 * ids が空の間はクエリを無効化する（初期リスト無しの通常作成で発火しない）。
 */
export function useWorksLookup(ids: number[]) {
  const { getToken, isSignedIn } = useAuth();
  // API 側は X-Annict-Token 必須。未連携のうちは 401 になるだけなので無効化する。
  const { isConnected } = useAnnictConnection();
  // ids の内容が変わったときだけクエリキーを変える（参照ではなく値で比較）。
  const key = ids.join(",");

  return useQuery({
    queryKey: ["works", "lookup", key] as const,
    enabled: !!isSignedIn && isConnected && ids.length > 0,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works.lookup.$get(
        { query: { ids: key } },
        {
          headers: { Authorization: `Bearer ${token}`, ...annictHeader },
        },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品の取得に失敗しました");
      }
      return res.json();
    },
  });
}
