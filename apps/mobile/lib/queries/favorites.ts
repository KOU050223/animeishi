import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

type FavoritesResponse = InferResponseType<
  (typeof apiClient.me)["favorites"]["$get"],
  200
>;
export type FavoriteItem = FavoritesResponse[number];

// 推しドメイン（/me/favorites*）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。all / key は無効化・楽観更新用、query は
// useQuery に spread して使う。enabled 等の呼び出し側依存のオプションは
// 呼び出し側で足す。
export const favoriteQueries = {
  all: ["favorites"] as const,
  key: (userId: string) => [...favoriteQueries.all, userId] as const,
  /**
   * 本人の推し一覧（GET /me/favorites）。
   * userId は未確定（null）でも受け取り、その間はプレフィックスキーにする
   * （呼び出し側の enabled で発火しない）。
   */
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? favoriteQueries.key(args.userId)
          : favoriteQueries.all,
        queryFn: async () => {
          const res = await apiClient.me.favorites.$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "推しの取得に失敗しました",
              }),
            },
          );
          // apiFetch が !ok を排除済みなので、res.json() の union から
          // 成功型に絞る。
          return res.json() as Promise<FavoritesResponse>;
        },
      }),
  },
} as const;
