import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { useAnnictConnection } from "@/lib/annict";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import {
  analysisQueries,
  type GetRecommendationsResponse,
  type GenerateRecommendationsResponse,
} from "@/lib/queries/analysis";

// AI おすすめ生成（issue #335）。useAnalysis と同じ構成で、
// GET は保存済みの結果を返し、POST が Workers AI＋Annict searchWorks で
// 生成する。生成には Annict 照合が要るため POST には Annict トークンを載せ、
// 生成前に履歴を read-through 同期する（POST /me/analysis と同じ流儀）。
export type RecommendationsResult = NonNullable<
  GetRecommendationsResponse["recommendations"]
>;
export type RecommendedWork = RecommendationsResult["works"][number];

export const RECOMMENDATIONS_QUERY_KEY = analysisQueries.recommendations.all;

const recommendationsQueryKey = (userId: string) =>
  analysisQueries.recommendations.key(userId);

/** 保存済みのおすすめ結果を取得する。未実行なら recommendations=null。 */
export function useRecommendations() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...analysisQueries.recommendations.result.query({
      userId: userId ?? null,
    }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * おすすめを生成する（POST /me/analysis/recommendations）。
 * API 側は D1 の履歴スナップショットを見るため、Annict 連携済みなら先に
 * GET /me/watch-histories で read-through 同期してから生成する
 * （POST /me/analysis と同じ。未連携なら既存スナップショットのまま試みるが、
 * 照合に Annict トークンが要るため未連携では 401 になる）。
 * 同一入力の 24h キャッシュは API 側が返す（cached=true）。
 */
export function useGenerateRecommendations() {
  const { userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GenerateRecommendationsResponse> => {
      // 連携済みなら生成前に履歴を最新化する（POST /me/analysis と同じ）。
      if (isConnected) {
        await apiClient.me["watch-histories"].$get(
          {},
          {
            fetch: apiFetch({
              annict: true,
              errorMessage:
                "視聴履歴の同期に失敗しました。時間をおいて再度お試しください",
            }),
          },
        );
      }
      // 生成の POST は Annict 照合が要るため Annict トークンも載せる
      // （履歴 GET と同じ annict オプトインで付与される）。
      const res = await apiClient.me.analysis.recommendations.$post(undefined, {
        fetch: apiFetch({
          annict: true,
          // 429 等は {error} に制限理由が入るため、標準の
          // ApiRequestError 化ではなく応答の文言を拾う。
          onHttpError: async (errorRes) => {
            const body = (await errorRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            return new ApiRequestError(
              errorRes.status,
              body?.error ?? "おすすめの生成に失敗しました",
            );
          },
        }),
      });
      // apiFetch が !ok を排除済みなので、res.json() の union から
      // 成功型に絞る。
      return res.json() as Promise<GenerateRecommendationsResponse>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userId
          ? recommendationsQueryKey(userId)
          : RECOMMENDATIONS_QUERY_KEY,
      });
      // 生成前の同期で履歴の表示データも変わり得るため併せて無効化する。
      void queryClient.invalidateQueries({
        queryKey: userId
          ? [...WATCH_HISTORY_QUERY_KEY, userId]
          : WATCH_HISTORY_QUERY_KEY,
      });
    },
  });
}
