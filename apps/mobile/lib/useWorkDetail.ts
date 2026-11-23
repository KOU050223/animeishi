import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useWorkCatalogAccess } from "@/lib/annict";
import { workQueries } from "@/lib/queries/works";

export type { WorkDetail, WorkDetailResponse } from "@/lib/queries/works";

// 詳細シートのクエリキー。state（viewerStatusState）は閲覧ユーザー固有の
// 値なので、視聴履歴と同じく userId でスコープする。共有端末でユーザーが
// 切り替わっても前ユーザーの視聴状態を再利用しないため。
export const WORK_DETAIL_QUERY_KEY = workQueries.detail.all;
export const workDetailQueryKey = workQueries.detail.key;

/**
 * 作品詳細シートに出す 1 作品分のメタ（GET /works/:annictWorkId。issue #347）。
 * 一覧カードの検索結果（AnimeTitle）には無い詳細フィールド（話数・メディア
 * 種別・公式サイト等）と、Annict viewerStatusState 由来の視聴ステータス
 * （state）を持つ。一覧と同じく作品情報を使えるとき（連携済み、または
 * 共用トークンあり。issue #561）に有効化する。未連携のときは state が常に null。
 */
export function useWorkDetail(annictWorkId: number | null) {
  const { isSignedIn, userId } = useAuth();
  const { canBrowseWorks, isConnected } = useWorkCatalogAccess();

  return useQuery({
    // userId 未確定の間はファクトリ側がプレフィックスキーに分岐する
    // （enabled=false で発火しない）。
    ...workQueries.detail.query({
      userId: userId ?? null,
      annictWorkId: annictWorkId ?? 0,
      isConnected,
    }),
    enabled: !!isSignedIn && !!userId && canBrowseWorks && annictWorkId != null,
  });
}
