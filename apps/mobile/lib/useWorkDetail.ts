import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";

type WorkDetailResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["$get"],
  200
>;
export type WorkDetail = WorkDetailResponse["work"];

// 詳細シートのクエリキー。state（viewerStatusState）は閲覧ユーザー固有の
// 値なので、視聴履歴と同じく userId でスコープする。共有端末でユーザーが
// 切り替わっても前ユーザーの視聴状態を再利用しないため。
export const WORK_DETAIL_QUERY_KEY = ["works", "detail"] as const;
export const workDetailQueryKey = (userId: string, annictWorkId: number) =>
  [...WORK_DETAIL_QUERY_KEY, userId, annictWorkId] as const;

/**
 * 作品詳細シートに出す 1 作品分のメタ（GET /works/:annictWorkId。issue #347）。
 * 一覧カードの検索結果（AnimeTitle）には無い詳細フィールド（話数・メディア
 * 種別・公式サイト等）と、Annict viewerStatusState 由来の視聴ステータス
 * （state）を持つ。一覧と同じく Annict 連携済みのときだけ有効化する。
 */
export function useWorkDetail(annictWorkId: number | null) {
  const { getToken, isSignedIn, userId } = useAuth();
  const { isConnected } = useAnnictConnection();

  return useQuery({
    queryKey: userId
      ? workDetailQueryKey(userId, annictWorkId ?? 0)
      : WORK_DETAIL_QUERY_KEY,
    enabled: !!isSignedIn && !!userId && isConnected && annictWorkId != null,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works[":annictWorkId"].$get(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers: { Authorization: `Bearer ${token}`, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品情報の取得に失敗しました");
      }
      return res.json();
    },
  });
}
