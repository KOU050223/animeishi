import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { useAnnictConnection } from "./useAnnictConnection";

export const WORK_CATALOG_STATUS_QUERY_KEY = [
  "works",
  "catalog-status",
] as const;

export type WorkCatalogAccess = {
  /** 作品検索・Tier 表・作品画像ピッカー等、作品情報だけを使う機能を使えるか。 */
  canBrowseWorks: boolean;
  /** 本人が Annict 連携済みか。視聴ステータス・視聴履歴などはこちらで判定する。 */
  isConnected: boolean;
  /** 連携状態または共用トークンの有無が未確定の間 true。この間はゲートを出さない。 */
  isLoading: boolean;
};

/**
 * 作品情報（検索・作品詳細・キャラクター一覧）を使えるかを返す（issue #561）。
 *
 * API は本人のトークンが無ければ運営者の共用トークンで作品情報を引く。共用トークンが
 * サーバーに設定されていないと未連携の利用者は 401 になるため、GET /works/catalog-status
 * で有無を確かめ、無ければ従来どおり連携誘導（AnnictSoftGate）を出させる。
 */
export function useWorkCatalogAccess(): WorkCatalogAccess {
  const { isSignedIn } = useAuth();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();

  // 連携済みなら共用トークンの有無は関係ないので問い合わせない。
  const status = useQuery({
    queryKey: WORK_CATALOG_STATUS_QUERY_KEY,
    enabled: !!isSignedIn && !isConnectionLoading && !isConnected,
    queryFn: async () => {
      const res = await apiClient.works["catalog-status"].$get(
        {},
        {
          // 一時的な失敗を「共用トークン無し」として成功扱いでキャッシュ
          // しない（残っている間ずっと連携誘導が出るため）。ApiRequestError
          // ではなく plain Error のまま失敗にしてリトライ・再取得させ、
          // 確定するまでの表示は canBrowseWorks=false（連携誘導）側に倒す。
          fetch: apiFetch({
            onHttpError: async (errorRes) =>
              new Error(`catalog-status failed (${errorRes.status})`),
          }),
        },
      );
      return res.json();
    },
  });

  const sharedCatalogAvailable = status.data?.sharedCatalogAvailable ?? false;
  return {
    canBrowseWorks: isConnected || sharedCatalogAvailable,
    isConnected,
    isLoading: isConnectionLoading || (!isConnected && status.isLoading),
  };
}
