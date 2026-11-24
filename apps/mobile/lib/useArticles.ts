import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { articleQueries } from "@/lib/queries/articles";

export type { Article, ArticleListItem } from "@/lib/queries/articles";

export const ARTICLES_QUERY_KEY = articleQueries.all;

// 運営が書く特集記事の新着（issue #437）。公開期間の絞り込みは API 側で
// 行うため、ここでは件数だけ指定する。
export function useLatestArticles() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...articleQueries.latest.query(),
    enabled: !!isSignedIn,
  });
}

// 記事一覧ページ（issue #599、/article）用。useLatestArticles より多い
// 件数を取るため、ホーム枠とクエリキーを分ける。
export function useArticleList() {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...articleQueries.list.query(),
    enabled: !!isSignedIn,
  });
}

// 記事詳細（本文 Markdown つき）。slug は /article/[slug] のパラメータ。
// 公開期間外・存在しない slug は API が 404 を返す。
export function useArticle(slug: string | null) {
  const { isSignedIn } = useAuth();

  return useQuery({
    ...articleQueries.detail.query({ slug: slug ?? "" }),
    enabled: !!isSignedIn && slug !== null && slug !== "",
  });
}
