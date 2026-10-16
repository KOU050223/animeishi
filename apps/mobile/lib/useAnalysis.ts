import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

// 視聴傾向分析（issue #22）。サーバー側で D1 の視聴履歴キャッシュを集計して
// Workers AI に投げるため、Annict トークンは不要（Clerk JWT のみ）。
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
 * 同一入力の 24h キャッシュは API 側が返す（cached=true）ため、
 * ここでは呼ぶだけでよい。429（生成回数制限）時はサーバー応答の
 * メッセージを ApiRequestError に載せる。
 */
export function useGenerateAnalysis() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GenerateAnalysisResponse> => {
      const headers = await getAuthHeaders(getToken);
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
    },
  });
}
