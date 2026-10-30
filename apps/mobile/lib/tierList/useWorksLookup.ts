import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";

// GET /works/lookup の ids 上限（worksLookupQuerySchema.max(50)）と揃える。
// 作品リスト（issue #349）は 500 作品まで持てるため、全 ID を 1 リクエストで
// 送ると 400 になる。50 件ずつに分けて引く。
const LOOKUP_ID_CHUNK = 50;

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
      const headers = {
        Authorization: `Bearer ${token}`,
        ...annictHeader,
      };

      const fetchBatch = async (chunk: number[]) => {
        const res = await apiClient.works.lookup.$get(
          { query: { ids: chunk.join(",") } },
          { headers },
        );
        if (!res.ok) {
          throw new ApiRequestError(res.status, "作品の取得に失敗しました");
        }
        return (await res.json()).works;
      };

      // API がキャッシュ未命中の分を Annict へ問い合わせるため、バッチは
      // 直列にして同時リクエストを増やさない。返却は各バッチとも
      // リクエスト ID 順なので、取った順に連結すれば元の並びが保たれる。
      const works: Awaited<ReturnType<typeof fetchBatch>> = [];
      for (let i = 0; i < ids.length; i += LOOKUP_ID_CHUNK) {
        works.push(...(await fetchBatch(ids.slice(i, i + LOOKUP_ID_CHUNK))));
      }
      return { works };
    },
  });
}
