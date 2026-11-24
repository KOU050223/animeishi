import { queryOptions } from "@tanstack/react-query";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

/** GET /episode-jobs/current が返すジョブ状態。 */
export type DanimeEpisodeJob = {
  id: string;
  status: "matching" | "writing" | "completed" | "failed";
  /** 書き込み予定の話数（matching 完了後に確定）。 */
  total: number;
  done: number;
  failed: number;
  /** Annict に記録済みで書かなかった話数。 */
  skipped: number;
  /** 対応付けが確定しなかった話数。 */
  unmatched: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

// 話単位の記録ジョブ（issue #477、/me/import/danime/episode-jobs）の
// クエリファクトリ（issue #726）。キー値は移行前と同一。
export const danimeQueries = {
  episodeJob: {
    all: ["danime-episode-job"] as const,
    // アカウントを切り替えても前ユーザーのジョブが残らないよう
    // キーにユーザー ID を含める（キャッシュは共有・永続化される）。
    key: (userId: string | null | undefined) =>
      [...danimeQueries.episodeJob.all, userId] as const,
    query: (args: { userId: string | null | undefined }) =>
      queryOptions({
        queryKey: danimeQueries.episodeJob.key(args.userId),
        queryFn: async (): Promise<DanimeEpisodeJob | null> => {
          const res = await apiClient.me["import"].danime[
            "episode-jobs"
          ].current.$get(
            {},
            {
              fetch: apiFetch({
                // ステータスを文言に含める契約は TranslationKey では
                // 表せないため onHttpError で維持する。
                onHttpError: async (errorRes) =>
                  new ApiRequestError(
                    errorRes.status,
                    `話数記録ジョブの取得に失敗しました（HTTP ${errorRes.status}）`,
                  ),
              }),
            },
          );
          return (await res.json()).job;
        },
      }),
  },
} as const;
