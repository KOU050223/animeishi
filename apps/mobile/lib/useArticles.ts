import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

type ArticlesResponse = InferResponseType<
  (typeof apiClient.articles)["$get"],
  200
>;
export type ArticleListItem = ArticlesResponse["items"][number];

type ArticleResponse = InferResponseType<
  (typeof apiClient.articles)[":slug"]["$get"],
  200
>;
export type Article = ArticleResponse;

export const ARTICLES_QUERY_KEY = ["articles"] as const;
// slug に "latest" を名付けた記事と一覧キーが衝突しないよう detail で隔てる
const articleQueryKey = (slug: string) => ["articles", "detail", slug] as const;

// ホームの特集枠に出す新着件数（issue #437）。
const HOME_ARTICLES_LIMIT = "3";

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

// 運営が書く特集記事の新着（issue #437）。公開期間の絞り込みは API 側で
// 行うため、ここでは件数だけ指定する。
export function useLatestArticles() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: [...ARTICLES_QUERY_KEY, "latest"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.articles.$get(
        { query: { limit: HOME_ARTICLES_LIMIT } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "特集記事の取得に失敗しました");
      }
      return res.json();
    },
  });
}

// 記事詳細（本文 Markdown つき）。slug は /article/[slug] のパラメータ。
// 公開期間外・存在しない slug は API が 404 を返す。
export function useArticle(slug: string | null) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: articleQueryKey(slug ?? ""),
    enabled: !!isSignedIn && slug !== null && slug !== "",
    queryFn: async () => {
      const headers = await getAuthHeaders(getToken);
      const res = await apiClient.articles[":slug"].$get(
        { param: { slug: slug ?? "" } },
        { headers },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "記事の取得に失敗しました");
      }
      return res.json();
    },
  });
}
