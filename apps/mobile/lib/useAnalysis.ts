import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient, apiFetch } from "@/lib/api";
import {
  ApiRequestError,
  readApiErrorCode,
  readRetryAfterSeconds,
} from "@/lib/apiError";
import { apiErrorMessage } from "@/lib/apiErrorMessages";
import { useAnnictConnection } from "@/lib/annict";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import {
  analysisQueries,
  type GetAnalysisResponse,
  type GenerateAnalysisResponse,
} from "@/lib/queries/analysis";

// 視聴傾向分析（issue #22）。POST 自体は D1 の視聴履歴キャッシュを集計して
// Workers AI に投げるため Annict トークンは不要だが、生成直前に連携済みなら
// GET /me/watch-histories（read-through 同期）を叩いてスナップショットを
// 最新化してから分析する。
export type AnalysisResult = NonNullable<GetAnalysisResponse["analysis"]>;

export const ANALYSIS_QUERY_KEY = analysisQueries.all;

const analysisQueryKey = (userId: string) => analysisQueries.key(userId);

/** 保存済みの分析結果を取得する。未実行なら analysis=null。 */
export function useAnalysis() {
  const { isSignedIn, userId } = useAuth();

  return useQuery({
    ...analysisQueries.result.query({ userId: userId ?? null }),
    enabled: !!isSignedIn && !!userId,
  });
}

/**
 * 分析を実行する（POST /me/analysis）。
 * POST は D1 の履歴スナップショットを見るため、Annict 連携済みなら先に
 * GET /me/watch-histories で read-through 同期してから生成する
 * （未連携なら既存スナップショットのまま生成を試みる）。
 * 同一入力の 24h キャッシュは API 側が返す（cached=true）ため、
 * ここでは呼ぶだけでよい。429（生成回数制限）時は応答の code から
 * 表示文言を引いて ApiRequestError に載せる（issue #838）。
 */
export function useGenerateAnalysis() {
  const { userId } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GenerateAnalysisResponse> => {
      // 連携済みなら生成前に履歴を最新化する（POST は D1 スナップショットを
      // 見るため、この GET の read-through が同期の導線になる）。
      // 同期に失敗した場合は古い履歴での生成を避けてエラーにする。
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
      const res = await apiClient.me.analysis.$post(undefined, {
        // 429（生成回数制限）等は code から表示文言を引く（issue #838）。
        fetch: apiFetch({
          onHttpError: async (errorRes) => {
            const code = await readApiErrorCode(errorRes);
            return new ApiRequestError(
              errorRes.status,
              apiErrorMessage(code) ?? "分析に失敗しました",
              code,
              readRetryAfterSeconds(errorRes),
            );
          },
        }),
      });
      // apiFetch が !ok を排除済みなので、res.json() の union から
      // 成功型に絞る。
      return res.json() as Promise<GenerateAnalysisResponse>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userId ? analysisQueryKey(userId) : ANALYSIS_QUERY_KEY,
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
