import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

type ExchangeRecordsResponse = InferResponseType<
  (typeof apiClient.me)["exchange-records"]["$get"],
  200
>;
export type ExchangeRecordItem = ExchangeRecordsResponse[number];

export type ExchangeRecordCreateResponse = Extract<
  InferResponseType<(typeof apiClient.me)["exchange-records"]["$post"]>,
  { id: number }
>;

// 交換記録（/me/exchange-records、issue #661）のクエリファクトリ
// （issue #726）。キー値は移行前と同一。
export const exchangeRecordQueries = {
  all: ["exchange-records"] as const,
  key: (userId: string) => [...exchangeRecordQueries.all, userId] as const,
  /** 自分の交換記録を全件（会った日時の降順）で返す。 */
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? exchangeRecordQueries.key(args.userId)
          : exchangeRecordQueries.all,
        queryFn: async () => {
          const res = await apiClient.me["exchange-records"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "交換記録の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ExchangeRecordsResponse>;
        },
      }),
  },
} as const;
