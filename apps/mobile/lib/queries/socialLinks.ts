import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch, clerkSessionToken } from "@/lib/api";

export type SocialLinksResponse = InferResponseType<
  (typeof apiClient.me)["social-links"]["$get"],
  200
>;

// SNS リンク（/me/social-links）のクエリファクトリ（issue #726）。
// キー値は移行前と同一（["social-links", userId]、userId 未確定でも
// 同じ形にする）。
export const socialLinkQueries = {
  all: ["social-links"] as const,
  key: (userId: string | null | undefined) =>
    [...socialLinkQueries.all, userId] as const,
  list: {
    query: (args: { userId: string | null | undefined }) =>
      queryOptions({
        queryKey: socialLinkQueries.key(args.userId),
        queryFn: async () => {
          // トークン欠如は "Unauthorized" の plain Error を投げる
          // 移行前の契約を維持する（apiFetch の i18n 文言とは別契約）。
          if (!(await clerkSessionToken())) throw new Error("Unauthorized");
          const res = await apiClient.me["social-links"].$get(
            {},
            {
              fetch: apiFetch({
                errorMessage: "SNS リンクの取得に失敗しました",
              }),
            },
          );
          return res.json();
        },
      }),
  },
} as const;
