import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";

// 検索語入力のたびに Annict へ問い合わせないためのデバウンス時間（ms）。
const SEARCH_DEBOUNCE_MS = 300;

type WorksSearchResponse = InferResponseType<
  typeof apiClient.works.search.$get,
  200
>;
export type AnimeTitle = WorksSearchResponse["works"][number];

export type SortKey = "title" | "year";
export type SortOrder = "asc" | "desc";

// 検索クエリごとにキャッシュを分けるためのクエリキー。
// query を含めることで、語を変えるたびに別エントリとしてキャッシュされる。
// 検索語が空のときは season（明示された絞り込み、または今期の既定）でキャッシュを分ける。
export const ANIME_LIST_QUERY_KEY = ["works", "search"] as const;

// シーズン検索（検索語なし）のクエリキー。シーズン作品一覧は tier 表画面でも
// 同じ /works/search?season= の結果を使うためキーを共有し、一方で取れた
// キャッシュやプリフェッチ（issue #173）が他方の表示にも効くようにする。
export const seasonWorksQueryKey = (season: string) =>
  [...ANIME_LIST_QUERY_KEY, "season", season] as const;

const worksSearchQueryKey = (query: string, season: string | undefined) =>
  query !== ""
    ? ([...ANIME_LIST_QUERY_KEY, "title", query] as const)
    : season
      ? seasonWorksQueryKey(season)
      : ([...ANIME_LIST_QUERY_KEY, "season", "__current__"] as const);

async function getAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ Authorization: string }> {
  const token = await getToken();
  if (!token) throw new Error("認証トークンが取得できませんでした");
  return { Authorization: `Bearer ${token}` };
}

/** 値が変化しても一定時間落ち着くまで反映を遅らせる（入力のたびの検索発火を防ぐ）。 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * /works/search への 1 ページ分の問い合わせ。
 * useInfiniteQuery の queryFn とプリフェッチ（usePrefetchSeasonWorks）で共用する。
 * `query` が空ならシーズン検索（season 未指定はサーバー既定の今期）、
 * 非空なら title 検索が優先され season は送らない。
 */
export async function fetchWorksSearchPage(
  getToken: () => Promise<string | null>,
  params: {
    query: string;
    season: string | undefined;
    pageParam: string | undefined;
  },
): Promise<WorksSearchResponse> {
  const headers = await getAuthHeaders(getToken);
  // Annict トークンは native ではヘッダで、Web ではサーバー(D1)側で解決される。
  const annictHeader = await buildAnnictAuthHeader();
  const queryParams =
    params.query !== ""
      ? {
          title: params.query,
          ...(params.pageParam ? { after: params.pageParam } : {}),
        }
      : {
          ...(params.season ? { season: params.season } : {}),
          ...(params.pageParam ? { after: params.pageParam } : {}),
        };
  const res = await apiClient.works.search.$get(
    { query: queryParams },
    { headers: { ...headers, ...annictHeader } },
  );
  if (!res.ok) {
    throw new ApiRequestError(res.status, "作品の検索に失敗しました");
  }
  return res.json();
}

/**
 * Annict searchWorks をプロキシする作品検索フック。
 * Animeishi は作品マスタを持たず、検索語のたびにサーバー経由で Annict へ問い合わせる。
 *
 * 検索語が空のうちはシーズン検索になる。`season`（例: "2025-summer"）を渡すとその
 * シーズンで、渡さなければサーバーが今期を既定にして「今期アニメ」を返す。検索語が
 * あるときは title 検索が優先され、season は無視される。Annict 未連携のうちは無効化。
 *
 * 戻り値の `isConnected` は呼び出し側のソフトゲート（未連携時の連携誘導・手動更新の
 * ガード）に使う。`isSeason` は検索結果かシーズン一覧かの区別で、空状態の文言・件数
 * 表示の出し分けに使う。シーズン検索でサーバー側のページ上限に達した場合は
 * このフック内で次ページを自動追い読みする。`hasNextPage` / `endCursor` は
 * 最後に取得したページの状態を公開する。
 *
 * @param query  検索語（空ならシーズン一覧）。
 * @param season 絞り込むシーズン文字列（例: "2025-summer"）。未指定なら今期。
 */
export function useAnimeList(query: string, season?: string) {
  const { getToken, isSignedIn } = useAuth();
  // 検索は API 側で X-Annict-Token 必須。未連携のうちは 401 になるだけなので無効化する。
  // isConnectionLoading は SecureStore 読み込み中の判定。連携済みでも読み込み中は
  // isConnected=false になるため、呼び出し側はこの間ソフトゲートを出さない。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  // 入力のたびに Annict を叩かないよう、検索語が落ち着いてから発火する。
  const trimmed = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  // 検索語が空ならシーズン検索（title を送らず season を載せる。未指定ならサーバー既定の今期）。
  const isSeason = trimmed.length === 0;

  const result = useInfiniteQuery({
    queryKey: worksSearchQueryKey(trimmed, season),
    // 検索語が空でもシーズン一覧を出すため、連携済みなら常に有効化する。
    enabled: !!isSignedIn && isConnected,
    // 年/季節チップを切り替えると queryKey が変わり別クエリ扱いになるため、
    // 取得中に一覧が空表示へ切り替わらないよう前回の結果を保持する。
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<WorksSearchResponse> =>
      // title 省略時はシーズン検索。season 未指定ならサーバーが今期を既定にする。
      fetchWorksSearchPage(getToken, {
        query: trimmed,
        season,
        pageParam,
      }),
    getNextPageParam: (last) =>
      last.hasNextPage ? (last.endCursor ?? undefined) : undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;

  // シーズン検索はサーバー側のページ上限に達したときだけ hasNextPage が立つため、
  // 残りを自動で追い読みする（issue #163 でサーバー側全件取得にした後の受け口）。
  // タイトル検索は先頭ページ（上位50件）だけでよく、広い語で全件走査すると
  // 際限がないため追い読みしない。エラー時の再発火ループを防ぐため isError 中は止める。
  useEffect(() => {
    if (isSeason && hasNextPage && !isFetchingNextPage && !result.isError) {
      void fetchNextPage();
    }
  }, [
    isSeason,
    hasNextPage,
    isFetchingNextPage,
    result.isError,
    fetchNextPage,
  ]);

  const works = useMemo(
    () => result.data?.pages.flatMap((page) => page.works),
    [result.data],
  );
  const lastPage = result.data?.pages.at(-1);

  return {
    ...result,
    // 一覧表示用に全ページの works を平坦化した配列（後方互換のため data 名で公開）。
    data: works,
    // 連携状態と次ページ情報。呼び出し側のソフトゲート/追い読みに使う。
    isConnected,
    isConnectionLoading,
    // 今期アニメ初期表示か検索結果かの区別（空状態の文言・件数表示の出し分け用）。
    isSeason,
    hasNextPage: lastPage?.hasNextPage ?? false,
    endCursor: lastPage?.endCursor ?? null,
  };
}

/**
 * シーズン作品一覧をキャッシュへ事前取得する（issue #173）。
 * シーズン切り替え直後の待ち時間を消すため、表示中シーズンの前後を
 * 呼び出し側で計算して渡す（components/anime-list の adjacentSeasonParams）。
 *
 * staleTime 内のキャッシュ済みシーズンは react-query 側で再取得されない。
 * プリフェッチの失敗自体は画面に出さないが、失敗クエリは error 状態のまま
 * キャッシュに残るため、データを持たない失敗エントリは取得後に除去する
 * （残すと切り替え先で自動リフェッチ中ずっとエラー画面が出てしまう）。
 * シーズン検索は 1 ページ目のレスポンスに全件が入る（サーバー側で全ページ取得）
 * ため先頭ページだけを取る。稀な上限到達時の続きは切り替え後の追い読みに任せる。
 */
export function usePrefetchSeasonWorks(
  seasons: readonly string[],
  enabled: boolean,
) {
  const { getToken, isSignedIn } = useAuth();
  const { isConnected } = useAnnictConnection();
  const queryClient = useQueryClient();
  const canPrefetch = enabled && !!isSignedIn && isConnected;
  // 配列の中身が変わったときだけ発火させるためプリミティブに潰す
  // （season 文字列に "," は含まれない）。
  const seasonsKey = seasons.join(",");

  useEffect(() => {
    if (!canPrefetch || seasonsKey === "") return;
    for (const season of seasonsKey.split(",")) {
      const queryKey = seasonWorksQueryKey(season);
      void queryClient
        .prefetchInfiniteQuery({
          queryKey,
          initialPageParam: undefined as string | undefined,
          queryFn: ({ pageParam }) =>
            fetchWorksSearchPage(getToken, { query: "", season, pageParam }),
        })
        .then(() => {
          // prefetchInfiniteQuery はエラーを握り潰して resolve するため、
          // 終了後にクエリ状態を見て失敗を拾う。既にデータを持つエントリの
          // 再取得失敗（error でも data 残存）は消さない。
          const state = queryClient.getQueryState(queryKey);
          if (state?.status === "error" && state.data === undefined) {
            queryClient.removeQueries({ queryKey, exact: true });
          }
        });
    }
  }, [canPrefetch, seasonsKey, queryClient, getToken]);
}

/**
 * 検索結果をクライアント側でソートする。
 * searchWorks 自体は並び順を制御できないため、表示順はここで決める。
 */
export function useSortedAnimeList(
  data: AnimeTitle[] | undefined,
  sortKey: SortKey,
  sortOrder: SortOrder,
) {
  return useMemo(() => {
    if (!data) return [];

    return [...data].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title, "ja");
      } else {
        cmp = (a.seasonYear ?? 0) - (b.seasonYear ?? 0);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortOrder]);
}
