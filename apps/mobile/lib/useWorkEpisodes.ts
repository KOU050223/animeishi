import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { workQueries } from "@/lib/queries/works";
import type { WorkEpisodesResponse } from "@/lib/queries/works";
import { ACHIEVEMENTS_QUERY_KEY } from "@/lib/achievements/useAchievements";
import { useAnnictConnection } from "@/lib/annict";
import { PROFILE_QUERY_KEY } from "@/lib/useProfile";
import { PUBLIC_PROFILE_QUERY_KEY } from "@/lib/publicProfile";

export type { WorkEpisode } from "@/lib/queries/works";

// 話数一覧のクエリキー。watched は閲覧ユーザー固有の値（Annict viewerDidTrack
// 由来）なので、視聴履歴と同じく userId でスコープする。
export const WORK_EPISODES_QUERY_KEY = workQueries.episodes.all;

/**
 * 作品詳細シートの話数チェック一覧が使う話数マスタ + 記録状況
 * （GET /works/:annictWorkId/episodes。issue #439）。
 * 話のマスタは Annict episodes が正で、API 側が Annict の既存記録を
 * D1 の記録ログと合わせて返す。記録は Annict 連携必須なので、
 * 未連携のうちはクエリを無効化する（useWorkDetail と同じ扱い）。
 */
export function useWorkEpisodes(annictWorkId: number | null) {
  const { isSignedIn, userId } = useAuth();
  const { isConnected } = useAnnictConnection();

  return useQuery({
    // userId 未確定の間はファクトリ側がプレフィックスキーに分岐する
    // （enabled=false で発火しない）。
    ...workQueries.episodes.query({
      userId: userId ?? null,
      annictWorkId: annictWorkId ?? 0,
    }),
    enabled: !!isSignedIn && !!userId && isConnected && annictWorkId != null,
  });
}

// 話の記録・解除ミューテーションのスコープ。同じスコープの mutation は
// MutationCache が直列実行する（チェックの連打・「次の話を記録」連打で
// リクエスト順が入れ替わり、サーバーの最終状態と画面が食い違うのを防ぐ）。
const EPISODE_RECORD_WRITE_SCOPE = "episode-record-write";

/**
 * useRecordEpisode / useUnrecordEpisode の mutateAsync が reject するエラーに
 * 付与する追加情報。楽観値を元に戻したかを呼び出し側が判定するために使う
 * （UpsertWatchHistoryError と同じ考え方）。
 */
export interface EpisodeRecordError extends Error {
  rolledBack?: boolean;
}

type EpisodeMutationContext = {
  previousWatched: boolean | undefined;
};

// 記録/解除で共有する楽観更新。話ごとの watched を対象値に書き換え、
// 失敗時は「自分が書いた値のまま残っている時だけ」元に戻す（後続の
// 別操作が乗っているならそちらに委ねる。useWatchHistory と同じ考え方）。
// userId は「いま見ている」吹き出しを出す本人プロフィールのクエリ
// （useProfile・自分の公開プロフィール）を無効化するために使う。
function optimisticWatchedHandlers(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  nextWatched: boolean,
  userId: string | null | undefined,
) {
  return {
    onMutate: async (
      annictEpisodeId: number,
    ): Promise<EpisodeMutationContext> => {
      await queryClient.cancelQueries({ queryKey });
      const previousWatched = queryClient
        .getQueryData<WorkEpisodesResponse>(queryKey)
        ?.episodes.find((e) => e.annictEpisodeId === annictEpisodeId)?.watched;
      queryClient.setQueryData<WorkEpisodesResponse>(queryKey, (old) =>
        old
          ? {
              ...old,
              episodes: old.episodes.map((e) =>
                e.annictEpisodeId === annictEpisodeId
                  ? { ...e, watched: nextWatched }
                  : e,
              ),
            }
          : old,
      );
      return { previousWatched };
    },
    onError: (
      error: Error,
      annictEpisodeId: number,
      context: EpisodeMutationContext | undefined,
    ) => {
      const previousWatched = context?.previousWatched;
      if (previousWatched === undefined) return;
      const stillMine =
        queryClient
          .getQueryData<WorkEpisodesResponse>(queryKey)
          ?.episodes.find((e) => e.annictEpisodeId === annictEpisodeId)
          ?.watched === nextWatched;
      if (stillMine) {
        queryClient.setQueryData<WorkEpisodesResponse>(queryKey, (old) =>
          old
            ? {
                ...old,
                episodes: old.episodes.map((e) =>
                  e.annictEpisodeId === annictEpisodeId
                    ? { ...e, watched: previousWatched }
                    : e,
                ),
              }
            : old,
        );
      }
      (error as EpisodeRecordError).rolledBack = stillMine;
    },
    onSettled: () => {
      // 他の書き込みが残っている間は再取得しない（残っている間に refetch
      // すると未反映のサーバー状態で楽観値が一瞬巻き戻る）。
      const pendingWrites = queryClient.isMutating({
        predicate: (mutation) =>
          mutation.options.scope?.id === EPISODE_RECORD_WRITE_SCOPE,
      });
      if (pendingWrites <= 1) {
        void queryClient.invalidateQueries({ queryKey });
        // 話の記録は実績（連続記録・今期完走）の判定入力になるため
        // 実績クエリも無効化して新規獲得を検出できるようにする（issue #415）。
        void queryClient.invalidateQueries({
          queryKey: ACHIEVEMENTS_QUERY_KEY,
        });
        // 「いま見ている」（issue #420）は本人の episode_records の
        // 最新 1 件から作られるため、記録・解除のたびに本人の
        // プロフィール系クエリも取り直す。
        void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
        if (userId) {
          // 公開プロフィールのキーは閲覧者ごとに分かれている（SNS リンクの
          // 可視範囲が閲覧者依存のため）ので、uid までの prefix で全閲覧者分を
          // 無効化する。
          void queryClient.invalidateQueries({
            queryKey: [...PUBLIC_PROFILE_QUERY_KEY, userId],
          });
        }
      }
    },
  };
}

/**
 * 話を「視聴済み」にする（PUT /me/episode-records/:annictEpisodeId）。
 * API 側で Annict createRecord も行われ、D1 に source=animeishi の
 * 記録ログが残る。
 */
export function useRecordEpisode(annictWorkId: number | null) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey =
    userId && annictWorkId != null
      ? workQueries.episodes.key(userId, annictWorkId)
      : workQueries.episodes.all;

  return useMutation({
    scope: { id: EPISODE_RECORD_WRITE_SCOPE },
    mutationFn: async (annictEpisodeId: number) => {
      const res = await apiClient.me["episode-records"][
        ":annictEpisodeId"
      ].$put(
        { param: { annictEpisodeId: String(annictEpisodeId) } },
        {
          fetch: apiFetch({
            annict: true,
            errorMessage: "話の記録に失敗しました",
          }),
        },
      );
      return res.json();
    },
    ...optimisticWatchedHandlers(queryClient, queryKey, true, userId),
  });
}

/**
 * 話の視聴記録を解除する（DELETE /me/episode-records/:annictEpisodeId）。
 * API 側で Annict deleteRecord も行われ、D1 の記録ログが消える。
 */
export function useUnrecordEpisode(annictWorkId: number | null) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey =
    userId && annictWorkId != null
      ? workQueries.episodes.key(userId, annictWorkId)
      : workQueries.episodes.all;

  return useMutation({
    scope: { id: EPISODE_RECORD_WRITE_SCOPE },
    mutationFn: async (annictEpisodeId: number) => {
      const res = await apiClient.me["episode-records"][
        ":annictEpisodeId"
      ].$delete(
        { param: { annictEpisodeId: String(annictEpisodeId) } },
        {
          fetch: apiFetch({
            annict: true,
            errorMessage: "話の記録解除に失敗しました",
          }),
        },
      );
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    ...optimisticWatchedHandlers(queryClient, queryKey, false, userId),
  });
}
