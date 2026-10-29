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

// 詳細シートの作品単位クエリキー。視聴ステータス変更後の再取得でも使う。
export const workDetailQueryKey = (annictWorkId: number) =>
  ["works", "detail", annictWorkId] as const;

/**
 * 作品詳細シートに出す 1 作品分のメタ（GET /works/:annictWorkId。issue #347）。
 * 一覧カードの検索結果（AnimeTitle）には無い詳細フィールド（話数・メディア
 * 種別・公式サイト等）と、Annict viewerStatusState 由来の視聴ステータス
 * （state）を持つ。一覧と同じく Annict 連携済みのときだけ有効化する。
 */
export function useWorkDetail(annictWorkId: number | null) {
  const { getToken, isSignedIn } = useAuth();
  const { isConnected } = useAnnictConnection();

  return useQuery({
    queryKey: workDetailQueryKey(annictWorkId ?? 0),
    enabled: !!isSignedIn && isConnected && annictWorkId != null,
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
