import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient, apiFetch } from "@/lib/api";

type ArticlesResponse = InferResponseType<
  (typeof apiClient.articles)["$get"],
  200
>;
export type ArticleListItem = ArticlesResponse["items"][number];

type ArticleResponse = InferResponseType<
  (typeof apiClient.articles)[":slug"]["$get"],
  200
>;

// ホームの特集枠に出す新着件数（issue #437）。
const HOME_ARTICLES_LIMIT = "3";
// 記事一覧ページ（issue #599）が出す件数。API の上限（50）に合わせる。
const ARTICLES_LIST_LIMIT = "50";

// 特集記事（/articles*）のクエリファクトリ（issue #726）。
// slug に "latest" を名付けた記事と一覧キーが衝突しないよう detail で
// 隔てる構造は既存のまま。キー値は移行前と同一。
export const articleQueries = {
  all: ["articles"] as const,
  /** ホームの新着枠（issue #437、3 件）。 */
  latest: {
    key: () => [...articleQueries.all, "latest"] as const,
    query: () =>
      queryOptions({
        queryKey: articleQueries.latest.key(),
        queryFn: async () => {
          const res = await apiClient.articles.$get(
            { query: { limit: HOME_ARTICLES_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "特集記事の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ArticlesResponse>;
        },
      }),
  },
  /** 一覧ページ（issue #599、50 件）。 */
  list: {
    key: () => [...articleQueries.all, "list"] as const,
    query: () =>
      queryOptions({
        queryKey: articleQueries.list.key(),
        queryFn: async () => {
          const res = await apiClient.articles.$get(
            { query: { limit: ARTICLES_LIST_LIMIT } },
            {
              fetch: apiFetch({
                errorMessage: "特集記事の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ArticlesResponse>;
        },
      }),
  },
  detail: {
    key: (slug: string) => [...articleQueries.all, "detail", slug] as const,
    query: (args: { slug: string }) =>
      queryOptions({
        queryKey: articleQueries.detail.key(args.slug),
        queryFn: async () => {
          const res = await apiClient.articles[":slug"].$get(
            { param: { slug: args.slug } },
            {
              fetch: apiFetch({
                errorMessage: "記事の取得に失敗しました",
              }),
            },
          );
          return res.json() as Promise<ArticleResponse>;
        },
      }),
  },
} as const;
