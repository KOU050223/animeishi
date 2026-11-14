import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import {
  WATCH_HISTORY_QUERY_KEY,
  WATCH_HISTORY_WRITE_SCOPE,
} from "@/lib/watchHistoryKey";

export type WorkDetailResponse = InferResponseType<
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

// 履歴キャッシュの行のうち追従に必要なフィールドだけの構造型。
// 実体は useWatchHistory の応答型だが、あちらはこのモジュールを
// import するため循環を避けてここで最小の形を宣言する。
type WatchHistoryCacheItem = { annictWorkId: number; state: string };

/**
 * 作品詳細シートに出す 1 作品分のメタ（GET /works/:annictWorkId。issue #347）。
 * 一覧カードの検索結果（AnimeTitle）には無い詳細フィールド（話数・メディア
 * 種別・公式サイト等）と、Annict viewerStatusState 由来の視聴ステータス
 * （state）を持つ。一覧と同じく Annict 連携済みのときだけ有効化する。
 */
export function useWorkDetail(annictWorkId: number | null) {
  const { getToken, isSignedIn, userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

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
      const json = await res.json();
      // ここで取れる state（Annict 直取り）は履歴の read-through キャッシュ
      // より新しいことがある。そのまま返すと詳細シートだけ新しい状態を
      // 出して一覧・ホームと食い違うため、履歴キャッシュの該当行を新しい
      // 値に揃える（issue #520）。invalidate→全件 read-through 再同期を
      // 走らせず行だけ書き換えるのは、1 作品の表示のたびに Annict 全ページ
      // 取得と D1 書き込みを起こさないため。履歴の書き込み
      // ミューテーション中は楽観値を上書きしないよう触らない。
      const writesPending =
        queryClient.isMutating({
          predicate: (m) => m.options.scope?.id === WATCH_HISTORY_WRITE_SCOPE,
        }) > 0;
      if (!writesPending && userId) {
        const historyKey = [...WATCH_HISTORY_QUERY_KEY, userId] as const;
        // 1 作品分の部分書き換えで履歴全体の dataUpdatedAt が今にならないよう、
        // 元の取得時刻を維持する（維持しないと stale な履歴が fresh 扱いになり、
        // ライブラリを開いても全件同期が走らない）。
        const updatedAt = queryClient.getQueryState(historyKey)?.dataUpdatedAt;
        queryClient.setQueryData<WatchHistoryCacheItem[]>(
          historyKey,
          (old) => {
            if (!old) return undefined;
            const index = old.findIndex(
              (item) => item.annictWorkId === annictWorkId,
            );
            // 変化が無いときは undefined を返して書き込み自体を行わない
            // （setQueryData は同じ配列を返しても dataUpdatedAt を更新する）。
            if (index < 0 || old[index].state === json.work.state)
              return undefined;
            // state=null（NO_STATE / ステータス解除）は履歴応答に行が
            // 無い形と一致させるため、キャッシュからも除く。
            const state = json.work.state;
            if (state == null) {
              return old.filter((item) => item.annictWorkId !== annictWorkId);
            }
            return old.map((item, i) =>
              i === index ? { ...item, state } : item,
            );
          },
          updatedAt == null ? undefined : { updatedAt },
        );
      }
      return json;
    },
  });
}
