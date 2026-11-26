import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";
import { ACHIEVEMENTS_QUERY_KEY } from "@/lib/queries/achievements";
import { WATCH_HISTORY_QUERY_KEY } from "@/features/watch-history/watchHistoryKey";
import { workQueries, type WorkDetailResponse } from "@/lib/queries/works";
import { invalidateCommonPoints } from "@/features/users/useCommonPoints";

export type WatchHistoriesResponse = InferResponseType<
  (typeof apiClient.me)["watch-histories"]["$get"],
  200
>;
export type WatchHistoryItem = WatchHistoriesResponse[number];
type WatchHistoryShareResponse = InferResponseType<
  (typeof apiClient.me)["watch-histories"]["share"]["$get"],
  200
>;

// 視聴履歴ドメイン（/me/watch-histories*）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。all / key は無効化・楽観更新用、query は
// useQuery に spread して使う。enabled 等の呼び出し側依存のオプションは
// 呼び出し側で足す。
export const watchHistoryQueries = {
  all: WATCH_HISTORY_QUERY_KEY,
  key: (userId: string) => [...WATCH_HISTORY_QUERY_KEY, userId] as const,
  /**
   * 本人の視聴履歴（GET /me/watch-histories。Annict libraryEntries を
   * read-through するため X-Annict-Token 必須）。
   * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
   * （呼び出し側の enabled で発火しない）。
   */
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? watchHistoryQueries.key(args.userId)
          : watchHistoryQueries.all,
        queryFn: async ({ client }) => {
          const res = await apiClient.me["watch-histories"].$get(
            {},
            {
              // Annict トークンは native ではヘッダで、Web では
              // サーバー(D1)側で解決される。
              fetch: apiFetch({
                annict: true,
                errorMessage: "視聴履歴の取得に失敗しました",
              }),
            },
          );
          const items = (await res.json()) as WatchHistoriesResponse;
          // read-through 同期で D1 の履歴（視聴数バッジの判定入力）が
          // 変わりうるため、実績クエリも無効化する（issue #415）。
          void client.invalidateQueries({
            queryKey: ACHIEVEMENTS_QUERY_KEY,
          });
          // 同期される D1 の履歴は共通点（視聴済み数・一緒に視聴中）の
          // 入力でもあるため、共通点クエリも無効化する。
          invalidateCommonPoints(client);
          // 詳細シートの state は別経路（viewerStatusState 直取り）で
          // キャッシュされ、同期後の履歴と食い違ったまま staleTime
          // いっぱい残りうる。食い違うキャッシュだけ無効化して、画面間で
          // ステータス表示を揃える（issue #520）。一致するものは触らない
          // （開いている詳細シートを不要に再取得させないため）。
          const syncedState = new Map(
            items.map((item) => [item.annictWorkId, item.state]),
          );
          for (const [key, detail] of client.getQueriesData<WorkDetailResponse>(
            {
              queryKey: workQueries.detail.all,
            },
          )) {
            // 詳細キーは userId でスコープされている。他人のキーを現在
            // ユーザーの履歴と突き合わせて無効化すると、そのまま active
            // なら現在ユーザーの state が他人のキーへ書き込まれるため絞る。
            if (!detail?.work || key[2] !== args.userId) continue;
            if (
              (syncedState.get(detail.work.annictWorkId) ?? null) ===
              detail.work.state
            )
              continue;
            void client.invalidateQueries({ queryKey: key, exact: true });
          }
          return items;
        },
      }),
  },

  share: {
    // userId でスコープする。ユーザー非依存のキーだと AsyncStorage に
    // 永続化されたクエリキャッシュがサインアウトをまたいで残り、同一端末で
    // 別の利用者がログインしたとき前の利用者の共有 URL が見える
    // （useWatchHistory のキー設計に揃える）。
    all: ["watch-history-share"] as const,
    key: (userId: string) =>
      [...watchHistoryQueries.share.all, userId] as const,
    /**
     * 発行中の共有トークン（GET /me/watch-histories/share）。
     * userId は未確定（null）でも受け取り、プレフィックスキーにする。
     */
    status: {
      query: (args: { userId: string | null }) =>
        queryOptions({
          queryKey: args.userId
            ? watchHistoryQueries.share.key(args.userId)
            : watchHistoryQueries.share.all,
          queryFn: async () => {
            const res = await apiClient.me["watch-histories"].share.$get(
              {},
              {
                fetch: apiFetch({
                  errorMessage: "共有リンクの取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<WatchHistoryShareResponse>;
          },
        }),
    },
  },
} as const;
