import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";

// 視聴傾向分析（issue #22）。POST 自体は D1 の視聴履歴キャッシュを集計して
// Workers AI に投げるため Annict トークンは不要だが、生成直前に連携済みなら
// GET /me/watch-histories（read-through 同期）を叩いてスナップショットを
// 最新化してから分析する。
type GetAnalysisResponse = InferResponseType<
  (typeof apiClient.me.analysis)["$get"],
  200
>;
type GenerateAnalysisResponse = InferResponseType<
  (typeof apiClient.me.analysis)["$post"],
  200
>;

export type AnalysisResult = NonNullable<GetAnalysisResponse["analysis"]>;

export const ANALYSIS_QUERY_KEY = ["analysis"] as const;

const analysisQueryKey = (userId: string) =>
  [...ANALYSIS_QUERY_KEY, userId] as const;

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 保存済みの分析結果を取得する。未実行なら analysis=null。 */
export function useAnalysis() {
  const { getToken, isSignedIn, userId } = useAuth();

  return useQuery({
    queryKey: userId ? analysisQueryKey(userId) : ANALYSIS_QUERY_KEY,
    enabled: !!isSignedIn && !!userId,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.me.analysis.$get({}, { headers });
      if (!res.ok) {
        throw new ApiRequestError(res.status, "分析結果の取得に失敗しました");
      }
      return res.json();
    },
  });
}

/**
 * 分析を実行する（POST /me/analysis）。
 * POST は D1 の履歴スナップショットを見るため、Annict 連携済みなら先に
 * GET /me/watch-histories で read-through 同期してから生成する
 * （未連携なら既存スナップショットのまま生成を試みる）。
 * 同一入力の 24h キャッシュは API 側が返す（cached=true）ため、
 * ここでは呼ぶだけでよい。429（生成回数制限）時はサーバー応答の
 * メッセージを ApiRequestError に載せる。
 */
export function useGenerateAnalysis() {
  const { getToken, userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GenerateAnalysisResponse> => {
      const headers = await getAuthHeaders(getToken);
      // 連携済みなら生成前に履歴を最新化する（POST は D1 スナップショットを
      // 見るため、この GET の read-through が同期の導線になる）。
      // 同期に失敗した場合は古い履歴での生成を避けてエラーにする。
      if (isConnected) {
        const annictHeader = await buildAnnictAuthHeader();
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
      const res = await apiClient.me.analysis.$post(undefined, { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new ApiRequestError(
          res.status,
          body?.error ?? "分析に失敗しました",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? analysisQueryKey(userId) : ANALYSIS_QUERY_KEY,
      });
      // 生成前の同期で履歴の表示データも変わり得るため併せて無効化する。
      queryClient.invalidateQueries({
        queryKey: userId
          ? [...WATCH_HISTORY_QUERY_KEY, userId]
          : WATCH_HISTORY_QUERY_KEY,
      });
    },
  });
}
