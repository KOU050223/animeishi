import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type ProfileResponse = InferResponseType<
  (typeof apiClient.me.profile)["$get"],
  200
>;
export type UpdateProfileResponse = InferResponseType<
  (typeof apiClient.me.profile)["$put"],
  200
>;

// プロフィールドメイン（/me/profile*・退会系）のクエリファクトリ
// （issue #726）。キー値は移行前と同一。
export const profileQueries = {
  all: ["profile"] as const,
  key: (userId: string) => [...profileQueries.all, userId] as const,
  /**
   * 本人のプロフィール（GET /me/profile）。
   * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
   * （呼び出し側の enabled で発火しない）。
   */
  me: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? profileQueries.key(args.userId)
          : profileQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.profile.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "プロフィールの取得に失敗しました",
              }),
            },
          );
          // apiFetch が !ok を排除済みなので、res.json() の union から
          // 成功型に絞る。
          return res.json() as Promise<ProfileResponse>;
        },
      }),
  },

  deletionSummary: {
    all: ["deletion-summary"] as const,
    /**
     * 退会時に削除されるデータの集計（GET /me/deletion-summary）。
     * 移行前は userId 未確定でもキー末尾に要素を載せていたため、
     * 値を変えないようそのままにする。
     */
    query: (args: { userId: string | null | undefined }) =>
      queryOptions({
        queryKey: [...profileQueries.deletionSummary.all, args.userId],
        queryFn: async () => {
          const res = await apiClient.me["deletion-summary"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "削除対象データの取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<DeletionSummaryResponse>;
        },
      }),
  },
} as const;

type DeletionSummaryResponse = InferResponseType<
  (typeof apiClient.me)["deletion-summary"]["$get"],
  200
>;
