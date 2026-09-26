import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { apiClient } from "@/lib/api";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import { isPlaceholderImageUrl } from "@/lib/anime/pickImageUrl";
import type { TierWork } from "./types";

// 画像未解決の作品が残っている間の再取得間隔と上限。
// サーバ側は検索ごとに未解決分を Queue 投入して非同期で resolvedImageUrl を
// 埋める（issue #86/#99）。AniList で取れなかった分は Jikan リトライになるため
// 初回レスポンスに間に合わず、解決済み URL を拾うには再取得が要る（issue #108）。
// malAnimeId を持たない等で永久に解決しない作品もあるため回数上限を設ける。
const IMAGE_RESOLVE_REFETCH_INTERVAL_MS = 5_000;
const IMAGE_RESOLVE_REFETCH_MAX_ATTEMPTS = 6;

/**
 * tier 表に並べるシーズン全作品を取得する。
 *
 * 1 シーズンは数十作品あり /works/search は 1 ページしか返さないため、
 * useInfiniteQuery で hasNextPage が尽きるまで自動で追い読みする。
 * ページ取得をサーバ側でループさせないのは、/works/search が呼び出しごとに
 * 画像フォールバックの Queue 投入を行うため、1 リクエスト内で回すと
 * Worker のサブリクエストと Annict への負荷が積み上がるため。
 */
export function useSeasonWorks(season: string) {
  const { getToken, isSignedIn } = useAuth();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();

  const query = useInfiniteQuery({
    queryKey: ["tier-list", "season-works", season] as const,
    enabled: !!isSignedIn && isConnected && !!season,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works.search.$get(
        { query: pageParam ? { season, after: pageParam } : { season } },
        {
          headers: { Authorization: `Bearer ${token}`, ...annictHeader },
        },
      );
      if (!res.ok) throw new Error("シーズン作品の取得に失敗しました");
      return res.json();
    },
    getNextPageParam: (last) =>
      last.hasNextPage ? (last.endCursor ?? undefined) : undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // シーズン全作品が揃うまで自動で追い読みする。tier 表は「全作品を並べる」のが
  // 前提なので、ユーザーに「もっと読む」を押させる導線は置かない。
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const works = useMemo<TierWork[]>(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.works.map((w) => ({
          annictWorkId: w.annictWorkId,
          title: w.title,
          imageUrl: w.imageUrl,
          resolvedImageUrl: w.resolvedImageUrl,
        })),
      ),
    [query.data],
  );

  // シーズン全作品の取得が終わったあとも表示用画像を持たない作品があるか。
  // Annict 画像が placeholder で resolvedImageUrl も無いものは裏の補完待ち。
  const hasPendingImages = works.some(
    (w) => w.resolvedImageUrl == null && isPlaceholderImageUrl(w.imageUrl),
  );

  const isLoading =
    !query.isError &&
    (query.isLoading || hasNextPage === true || isFetchingNextPage);

  // 未解決画像が残っている間は数回だけ遅延リフェッチして、Queue 側で
  // 解決された resolvedImageUrl を拾う。リフェッチごとに未解決分が
  // 再 enqueue されるので、取りこぼした補完の再点火にもなる。
  const [refetchAttempts, setRefetchAttempts] = useState(0);
  useEffect(() => setRefetchAttempts(0), [season]);
  useEffect(() => {
    if (
      isLoading ||
      query.isFetching ||
      query.isError ||
      !hasPendingImages ||
      refetchAttempts >= IMAGE_RESOLVE_REFETCH_MAX_ATTEMPTS
    ) {
      return;
    }
    const timer = setTimeout(() => {
      setRefetchAttempts((c) => c + 1);
      void query.refetch();
    }, IMAGE_RESOLVE_REFETCH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [
    isLoading,
    query.isFetching,
    query.isError,
    hasPendingImages,
    refetchAttempts,
    query.refetch,
  ]);

  return {
    works,
    // 追い読み中も「読み込み中」として扱う（途中の作品数で確定表示すると
    // ユーザーが「作品が足りない」と誤解するため）。
    // ただしエラー時は hasNextPage が true のまま止まるので、除外しないと
    // スピナーが永久に回り続けてエラー表示に到達できない。
    isLoading,
    isError: query.isError,
    isConnected,
    isConnectionLoading,
  };
}
