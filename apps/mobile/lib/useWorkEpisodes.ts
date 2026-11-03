import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError, readApiErrorCode } from "@/lib/apiError";
import { ACHIEVEMENTS_QUERY_KEY } from "@/lib/achievements/useAchievements";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { PROFILE_QUERY_KEY } from "@/lib/useProfile";
import { publicProfileQueryKey } from "@/lib/publicProfile";

type WorkEpisodesResponse = InferResponseType<
  (typeof apiClient.works)[":annictWorkId"]["episodes"]["$get"],
  200
>;
export type WorkEpisode = WorkEpisodesResponse["episodes"][number];

// 話数一覧のクエリキー。watched は閲覧ユーザー固有の値（Annict viewerDidTrack
// 由来）なので、視聴履歴と同じく userId でスコープする。
export const WORK_EPISODES_QUERY_KEY = ["works", "episodes"] as const;
export const workEpisodesQueryKey = (userId: string, annictWorkId: number) =>
  [...WORK_EPISODES_QUERY_KEY, userId, annictWorkId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/**
 * 作品詳細シートの話数チェック一覧が使う話数マスタ + 記録状況
 * （GET /works/:annictWorkId/episodes。issue #439）。
 * 話のマスタは Annict episodes が正で、API 側が Annict の既存記録を
 * D1 の記録ログと合わせて返す。記録は Annict 連携必須なので、
 * 未連携のうちはクエリを無効化する（useWorkDetail と同じ扱い）。
 */
export function useWorkEpisodes(annictWorkId: number | null) {
  const { getToken, isSignedIn, userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: userId
      ? workEpisodesQueryKey(userId, annictWorkId ?? 0)
      : WORK_EPISODES_QUERY_KEY,
    enabled: !!isSignedIn && !!userId && isConnected && annictWorkId != null,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works[":annictWorkId"].episodes.$get(
        { param: { annictWorkId: String(annictWorkId) } },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "話数情報の取得に失敗しました",
          await readApiErrorCode(res),
        );
      }
      // この GET は API 側で Annict の既存記録を D1 の記録ログに同期する。
      // 同期で判定入力が変わりうるため実績クエリを無効化する（issue #415）。
      void queryClient.invalidateQueries({
        queryKey: ACHIEVEMENTS_QUERY_KEY,
      });
      return res.json();
    },
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
          void queryClient.invalidateQueries({
            queryKey: publicProfileQueryKey(userId),
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
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey =
    userId && annictWorkId != null
      ? workEpisodesQueryKey(userId, annictWorkId)
      : WORK_EPISODES_QUERY_KEY;

  return useMutation({
    scope: { id: EPISODE_RECORD_WRITE_SCOPE },
    mutationFn: async (annictEpisodeId: number) => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["episode-records"][
        ":annictEpisodeId"
      ].$put(
        { param: { annictEpisodeId: String(annictEpisodeId) } },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "話の記録に失敗しました",
          await readApiErrorCode(res),
        );
      }
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
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey =
    userId && annictWorkId != null
      ? workEpisodesQueryKey(userId, annictWorkId)
      : WORK_EPISODES_QUERY_KEY;

  return useMutation({
    scope: { id: EPISODE_RECORD_WRITE_SCOPE },
    mutationFn: async (annictEpisodeId: number) => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.me["episode-records"][
        ":annictEpisodeId"
      ].$delete(
        { param: { annictEpisodeId: String(annictEpisodeId) } },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "話の記録解除に失敗しました",
          await readApiErrorCode(res),
        );
      }
      const ct = res.headers.get("content-type") ?? "";
      return ct.includes("application/json") ? res.json() : null;
    },
    ...optimisticWatchedHandlers(queryClient, queryKey, false, userId),
  });
}
