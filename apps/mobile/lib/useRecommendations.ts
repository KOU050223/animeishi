import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";

// AI おすすめ生成（issue #335）。useAnalysis と同じ構成で、
// GET は保存済みの結果を返し、POST が Workers AI＋Annict searchWorks で
// 生成する。生成には Annict 照合が要るため POST には Annict トークンを載せ、
// 生成前に履歴を read-through 同期する（POST /me/analysis と同じ流儀）。
type GetRecommendationsResponse = InferResponseType<
  (typeof apiClient.me.analysis.recommendations)["$get"],
  200
>;
type GenerateRecommendationsResponse = InferResponseType<
  (typeof apiClient.me.analysis.recommendations)["$post"],
  200
>;

export type RecommendationsResult = NonNullable<
  GetRecommendationsResponse["recommendations"]
>;
export type RecommendedWork = RecommendationsResult["works"][number];

export const RECOMMENDATIONS_QUERY_KEY = [
  "analysis",
  "recommendations",
] as const;

const recommendationsQueryKey = (userId: string) =>
  [...RECOMMENDATIONS_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 保存済みのおすすめ結果を取得する。未実行なら recommendations=null。 */
export function useRecommendations() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId
      ? recommendationsQueryKey(userId)
      : RECOMMENDATIONS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.analysis.recommendations.$get(
        {},
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "おすすめの取得に失敗しました");
      }
      return res.json();
    },
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
  const { getToken, userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GenerateRecommendationsResponse> => {
      const headers = await getAuthHeaders(getToken);
      const annictHeader = await buildAnnictAuthHeader();
      // 連携済みなら生成前に履歴を最新化する（POST /me/analysis と同じ）。
      if (isConnected) {
        const historyRes = await apiClient.me["watch-histories"].$get(
          {},
          { headers: { ...headers, ...annictHeader } },
        );
        if (!historyRes.ok) {
          throw new ApiRequestError(
            historyRes.status,
            "視聴履歴の同期に失敗しました。時間をおいて再度お試しください",
          );
        }
      }
      const res = await apiClient.me.analysis.recommendations.$post(undefined, {
        headers: { ...headers, ...annictHeader },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new ApiRequestError(
          res.status,
          body?.error ?? "おすすめの生成に失敗しました",
        );
      }
      return res.json();
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
