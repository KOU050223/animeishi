import { useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { useAnnictConnection } from "@/lib/annict";
import { fetchWorksSearchPage, seasonWorksQueryKey } from "@/lib/useAnimeList";
import type { TierItem } from "./types";

/**
 * tier 表に並べるシーズン全作品を取得する。
 *
 * /works/search のシーズン検索はサーバー側で全ページ取得して返す（issue #163）。
 * サーバー側の取得上限に達した稀なケースだけ hasNextPage が立つため、
 * useInfiniteQuery の追い読みはその継続取得の受け口として残す。
 */
export function useSeasonWorks(season: string) {
  const { getToken, isSignedIn } = useAuth();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();

  const query = useInfiniteQuery({
    // シーズン作品のキャッシュはアニメ一覧画面と共有する（同一の
    // /works/search?season= レスポンス）。一覧側の前後シーズンプリフェッチ
    // （issue #173）がこちらのシーズン切り替えにも効き、ここで取得した
    // データが一覧にも使い回される。
    queryKey: seasonWorksQueryKey(season),
    enabled: !!isSignedIn && isConnected && !!season,
    initialPageParam: undefined as string | undefined,
    // クエリキーを共有している以上、取得ロジックも一覧側と同一関数に揃える
    // （片方だけ変更されると同一キーに別ロジックが書き込まれる危険がある）。
    queryFn: ({ pageParam }) =>
      fetchWorksSearchPage(getToken, { query: "", season, pageParam }),
    getNextPageParam: (last) =>
      last.hasNextPage ? (last.endCursor ?? undefined) : undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // シーズン全作品が揃うまで自動で追い読みする。tier 表は「全作品を並べる」のが
  // 前提なので、ユーザーに「もっと読む」を押させる導線は置かない。
  // エラー時は isFetchingNextPage が false に戻るたび再発火してしまうため
  // （永続障害で無限リトライになる）、isError 中は追い読みを止める。
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !query.isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, query.isError, fetchNextPage]);

  const works = useMemo<TierItem[]>(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.works.map((w) => ({
          id: w.annictWorkId,
          title: w.title,
          // 画像は作品画像プロキシの URL だけを使う（issue #224）。
          // プロキシは作品単位で URL が変わらず、未取り込みの画像も
          // 表示時に取り込むので、補完待ちの再取得は要らない。
          imageUrl: w.hostedImageUrl,
        })),
      ),
    [query.data],
  );

  const isLoading =
    !query.isError &&
    (query.isLoading || hasNextPage === true || isFetchingNextPage);

  return {
    works,
    // 追い読み中も「読み込み中」として扱う（途中の作品数で確定表示すると
    // ユーザーが「作品が足りない」と誤解するため）。
    // ただしエラー時は hasNextPage が true のまま止まるので、除外しないと
    // スピナーが永久に回り続けてエラー表示に到達できない。
    isLoading,
    // 作品を既に持っている状態でのバックグラウンド再取得の失敗で盤面を
    // エラー画面に置き換えないよう、表示中の作品が無いときだけエラー扱いにする。
    isError: query.isError && works.length === 0,
    isConnected,
    isConnectionLoading,
  };
}
