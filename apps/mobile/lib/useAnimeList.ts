import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useWorkCatalogAccess } from "@/lib/annict";
import {
  dedupeWorksById,
  workQueries,
  type WorksSearchResponse,
} from "@/lib/queries/works";
import { sortAnimeList } from "./animeListSortFilter";
import type {
  AnimeListSortKey,
  AnimeListSortOrder,
} from "./animeListSortFilter";

// 検索語入力のたびに Annict へ問い合わせないためのデバウンス時間（ms）。
const SEARCH_DEBOUNCE_MS = 300;

export type AnimeTitle = WorksSearchResponse["works"][number];

// ソートキー・順序の実体は lib/animeListSortFilter.ts（純関数）。呼び出し側の
// 互換のためここからも再 export する（issue #346 で watchersCount を追加）。
export type {
  AnimeListSortKey as SortKey,
  AnimeListSortOrder as SortOrder,
} from "./animeListSortFilter";

// 検索応答の作品配列の dedupe と 1 ページ分の取得は
// クエリファクトリ（lib/queries/works）に集約した。呼び出し側の互換のため
// ここからも再 export する。
export { dedupeWorksById } from "@/lib/queries/works";

// 検索クエリごとにキャッシュを分けるためのクエリキー。
// query を含めることで、語を変えるたびに別エントリとしてキャッシュされる。
// 検索語が空のときは season（明示された絞り込み、または今期の既定）でキャッシュを分ける。
export const ANIME_LIST_QUERY_KEY = workQueries.search.all;

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
 * Annict searchWorks をプロキシする作品検索フック。
 * Animeishi は作品マスタを持たず、検索語のたびにサーバー経由で Annict へ問い合わせる。
 *
 * 検索語が空のうちはシーズン検索になる。`season`（例: "2025-summer"）を渡すとその
 * シーズンで、渡さなければサーバーが今期を既定にして「今期アニメ」を返す。検索語が
 * あるときは title 検索が優先され、season は無視される。作品情報を使えない
 * （未連携かつ共用トークン無し。issue #561）うちは無効化。
 *
 * 戻り値の `canBrowseWorks` は呼び出し側のソフトゲート（連携誘導・手動更新の
 * ガード）に使う。`isSeason` は検索結果かシーズン一覧かの区別で、空状態の文言・件数
 * 表示の出し分けに使う。シーズン検索でサーバー側のページ上限に達した場合は
 * このフック内で次ページを自動追い読みする。`hasNextPage` / `endCursor` は
 * 最後に取得したページの状態を公開する。
 *
 * @param query  検索語（空ならシーズン一覧）。
 * @param season 絞り込むシーズン文字列（例: "2025-summer"）。未指定なら今期。
 * @param options.fetchAllPages タイトル検索でも全ページを追い読みする。
 *        メディア・ジャンルのクライアント側絞り込みが有効なときに渡す
 *        （先頭 50 件だけに絞り込みが効いて後続ページの一致作品を
 *        見落とさないため。issue #346）。
 */
export function useAnimeList(
  query: string,
  season?: string,
  options: { fetchAllPages?: boolean } = {},
) {
  const { isSignedIn } = useAuth();
  // 検索は本人の Annict トークンか共用トークンが要る。どちらも無いうちは 401 に
  // なるだけなので無効化する。isAccessLoading は連携状態・共用トークン有無の確認中。
  // この間は canBrowseWorks=false になるため、呼び出し側はソフトゲートを出さない。
  const { canBrowseWorks, isLoading: isAccessLoading } = useWorkCatalogAccess();
  // 入力のたびに Annict を叩かないよう、検索語が落ち着いてから発火する。
  const trimmed = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  // 検索語が空ならシーズン検索（title を送らず season を載せる。未指定ならサーバー既定の今期）。
  const isSeason = trimmed.length === 0;

  const result = useInfiniteQuery({
    ...workQueries.search.query({ query: trimmed, season }),
    // 検索語が空でもシーズン一覧を出すため、作品情報を使えるなら常に有効化する。
    enabled: !!isSignedIn && canBrowseWorks,
    // 年/季節チップを切り替えると queryKey が変わり別クエリ扱いになるため、
    // 取得中に一覧が空表示へ切り替わらないよう前回の結果を保持する。
    placeholderData: keepPreviousData,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;

  // シーズン検索はサーバー側のページ上限に達したときだけ hasNextPage が立つため、
  // 残りを自動で追い読みする（issue #163 でサーバー側全件取得にした後の受け口）。
  // タイトル検索は先頭ページ（上位50件）だけでよく、広い語で全件走査すると
  // 際限がないため追い読みしない。ただしクライアント側絞り込みが有効なとき
  // （fetchAllPages）は先頭ページだけでは一致作品を見落とすため、絞り込み
  // 対象の全件になるまで追い読みする。
  // エラー時の再発火ループを防ぐため isError 中は止める。
  const fetchAllPages = isSeason || options.fetchAllPages === true;
  useEffect(() => {
    if (
      fetchAllPages &&
      hasNextPage &&
      !isFetchingNextPage &&
      !result.isError
    ) {
      void fetchNextPage();
    }
  }, [
    fetchAllPages,
    hasNextPage,
    isFetchingNextPage,
    result.isError,
    fetchNextPage,
  ]);

  const works = (() => {
    const flat = result.data?.pages.flatMap((page) => page.works);
    // ページを跨ぐと同じ作品が再出現し得る（順位変動・継続カーソル境界の
    // 取りこぼし）。重複がそのまま一覧・tier 表へ流れないようここで潰す。
    return flat ? dedupeWorksById(flat) : undefined;
  })();
  const lastPage = result.data?.pages.at(-1);

  return {
    ...result,
    // 一覧表示用に全ページの works を平坦化した配列（後方互換のため data 名で公開）。
    data: works,
    // 作品情報を使えるか。呼び出し側のソフトゲートに使う。
    canBrowseWorks,
    isAccessLoading,
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
  const { isSignedIn } = useAuth();
  const { canBrowseWorks } = useWorkCatalogAccess();
  const queryClient = useQueryClient();
  const canPrefetch = enabled && !!isSignedIn && canBrowseWorks;
  // 配列の中身が変わったときだけ発火させるためプリミティブに潰す
  // （season 文字列に "," は含まれない）。
  const seasonsKey = seasons.join(",");

  useEffect(() => {
    if (!canPrefetch || seasonsKey === "") return;
    for (const season of seasonsKey.split(",")) {
      const options = workQueries.search.query({ query: "", season });
      void queryClient.prefetchInfiniteQuery(options).then(() => {
        // prefetchInfiniteQuery はエラーを握り潰して resolve するため、
        // 終了後にクエリ状態を見て失敗を拾う。既にデータを持つエントリの
        // 再取得失敗（error でも data 残存）は消さない。
        const state = queryClient.getQueryState(options.queryKey);
        if (state?.status === "error" && state.data === undefined) {
          queryClient.removeQueries({
            queryKey: options.queryKey,
            exact: true,
          });
        }
      });
    }
  }, [canPrefetch, seasonsKey, queryClient]);
}

/**
 * 検索結果をクライアント側でソートする。
 * 比較ロジックは lib/animeListSortFilter.ts の純関数（sortAnimeList）に委譲する。
 */
export function useSortedAnimeList(
  data: AnimeTitle[] | undefined,
  sortKey: AnimeListSortKey,
  sortOrder: AnimeListSortOrder,
) {
  return data ? sortAnimeList(data, sortKey, sortOrder) : [];
}
