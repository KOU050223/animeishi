import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useWorkCatalogAccess } from "@/lib/annict";
import { workQueries } from "@/lib/queries/works";

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
  const { isSignedIn } = useAuth();
  // 本人の Annict トークンか共用トークンが要る（issue #561）。
  // どちらも無いうちは 401 になるだけなので無効化する。
  const { canBrowseWorks } = useWorkCatalogAccess();

  return useQuery({
    ...workQueries.lookup.query({ ids }),
    enabled: !!isSignedIn && canBrowseWorks && ids.length > 0,
  });
}
