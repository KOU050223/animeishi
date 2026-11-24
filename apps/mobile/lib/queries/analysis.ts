import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type GetAnalysisResponse = InferResponseType<
  (typeof apiClient.me.analysis)["$get"],
  200
>;
export type GenerateAnalysisResponse = InferResponseType<
  (typeof apiClient.me.analysis)["$post"],
  200
>;
export type GetRecommendationsResponse = InferResponseType<
  (typeof apiClient.me.analysis.recommendations)["$get"],
  200
>;
export type GenerateRecommendationsResponse = InferResponseType<
  (typeof apiClient.me.analysis.recommendations)["$post"],
  200
>;

// 視聴傾向分析・AI おすすめドメイン（/me/analysis*）のクエリファクトリ
// （issue #726）。キー値は移行前と同一。
export const analysisQueries = {
  all: ["analysis"] as const,
  key: (userId: string) => [...analysisQueries.all, userId] as const,
  /**
   * 保存済みの分析結果（GET /me/analysis。未実行なら analysis=null）。
   * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
   * （呼び出し側の enabled で発火しない）。
   */
  result: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? analysisQueries.key(args.userId)
          : analysisQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.analysis.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "分析結果の取得に失敗しました",
              }),
            },
          );
          // apiFetch が !ok を排除済みなので、res.json() の union から
          // 成功型に絞る。
          return res.json() as Promise<GetAnalysisResponse>;
        },
      }),
  },

  recommendations: {
    all: ["analysis", "recommendations"] as const,
    key: (userId: string) =>
      [...analysisQueries.recommendations.all, userId] as const,
    /**
     * 保存済みのおすすめ結果（GET /me/analysis/recommendations。
     * 未実行なら recommendations=null）。
     */
    result: {
      query: (args: { userId: string | null }) =>
        queryOptions({
          queryKey: args.userId
            ? analysisQueries.recommendations.key(args.userId)
            : analysisQueries.recommendations.all,
          queryFn: async () => {
            const res = await apiClient.me.analysis.recommendations.$get(
              {},
              {
                fetch: apiFetch({
                  errorMessage: "おすすめの取得に失敗しました",
                }),
              },
            );
            return res.json() as Promise<GetRecommendationsResponse>;
          },
        }),
    },
  },
} as const;
