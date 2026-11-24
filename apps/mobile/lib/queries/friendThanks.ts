import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

type FriendThanksResponse = InferResponseType<
  (typeof apiClient.me)["friend-thanks"]["$get"],
  200
>;
export type ReceivedThanksItem = FriendThanksResponse["received"][number];
export type SentThanksItem = FriendThanksResponse["sent"][number];
export type ThanksPresetKey = ReceivedThanksItem["presetKey"];

// 名刺交換後のお礼ドメイン（/me/friend-thanks*）のクエリファクトリ
// （issue #726）。キー値は移行前と同一。
export const friendThanksQueries = {
  all: ["friend-thanks"] as const,
  key: (userId: string) => [...friendThanksQueries.all, userId] as const,
  /** 届いた・送ったお礼の一覧（{ received, sent }、各新しい順）。 */
  list: {
    query: (args: { userId: string | null }) =>
      queryOptions({
        queryKey: args.userId
          ? friendThanksQueries.key(args.userId)
          : friendThanksQueries.all,
        queryFn: async () => {
          const res = await apiClient.me["friend-thanks"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "お礼の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<FriendThanksResponse>;
        },
      }),
  },
} as const;
