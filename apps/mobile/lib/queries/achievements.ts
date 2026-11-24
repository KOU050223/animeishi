import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type AchievementsResponse = InferResponseType<
  typeof apiClient.me.achievements.$get,
  200
>;

// 実績一覧のクエリキー。話の記録・ステータス更新のミューテーションから
// 無効化して獲得判定を再計算させるため、キーはここで共有する。
// 値は移行前（["achievements"]）と同一。
export const ACHIEVEMENTS_QUERY_KEY = ["achievements"] as const;

// 実績ドメイン（GET /me/achievements）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。
export const achievementQueries = {
  all: ACHIEVEMENTS_QUERY_KEY,
  key: (userId: string, season: string) =>
    [...ACHIEVEMENTS_QUERY_KEY, userId, season] as const,
  /**
   * 実績（バッジ）の獲得状況。今期完走の判定は Annict の話数マスタを
   * 使うため X-Annict-Token を付ける（未連携時は該当実績だけ
   * available=false で返る）。
   * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
   * （呼び出し側の enabled で発火しない）。
   */
  list: {
    query: (args: { userId: string | null; season: string }) =>
      queryOptions({
        queryKey: args.userId
          ? achievementQueries.key(args.userId, args.season)
          : achievementQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.achievements.$get(
            {},
            {
              fetch: apiFetch({
                annict: true,
                errorMessage: "実績の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<AchievementsResponse>;
        },
      }),
  },
} as const;
