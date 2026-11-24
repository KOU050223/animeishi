import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

export type ElectionsResponse = InferResponseType<
  (typeof apiClient.elections)["$get"],
  200
>;
export type ElectionListItem = ElectionsResponse["items"][number];

export type ElectionResponse = InferResponseType<
  (typeof apiClient.elections)[":slug"]["$get"],
  200
>;
export type ElectionDetail = ElectionResponse;
export type ElectionCandidate = ElectionDetail["candidates"][number];

// ホームの総選挙枠に出す件数（issue #438）。公開中の総選挙は
// 運営が登録するものだけなので、小さな上限で十分。
const HOME_ELECTIONS_LIMIT = "10";
// 総選挙一覧ページ（issue #599）が出す件数。API の上限（50）に合わせる。
const ELECTIONS_LIST_LIMIT = "50";

// 総選挙（/elections*）のクエリファクトリ（issue #726）。
// キー値は移行前と同一。
export const electionQueries = {
  all: ["elections"] as const,
  /** ホーム枠（10 件）。 */
  home: {
    query: () =>
      queryOptions({
        queryKey: electionQueries.all,
        queryFn: async () => {
          const res = await apiClient.elections.$get(
            { query: { limit: HOME_ELECTIONS_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "総選挙の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ElectionsResponse>;
        },
      }),
  },
  /** 一覧ページ（issue #599、50 件）。ホーム枠とキーを分ける。 */
  list: {
    key: () => [...electionQueries.all, "list"] as const,
    query: () =>
      queryOptions({
        queryKey: electionQueries.list.key(),
        queryFn: async () => {
          const res = await apiClient.elections.$get(
            { query: { limit: ELECTIONS_LIST_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "総選挙の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ElectionsResponse>;
        },
      }),
  },
  detail: {
    key: (slug: string) => [...electionQueries.all, "detail", slug] as const,
    query: (args: { slug: string }) =>
      queryOptions({
        queryKey: electionQueries.detail.key(args.slug),
        queryFn: async () => {
          const res = await apiClient.elections[":slug"].$get(
            { param: { slug: args.slug } },
            {
              fetch: apiFetch({
                errorMessage: "総選挙の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ElectionResponse>;
        },
      }),
  },
} as const;
