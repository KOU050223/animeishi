import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
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

const worksSearchQueryKey = (query: string, season: string | undefined) =>
  query !== ""
    ? ([...ANIME_LIST_QUERY_KEY, "title", query] as const)
    : ([...ANIME_LIST_QUERY_KEY, "season", season ?? "__current__"] as const);

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
 * Annict searchWorks をプロキシする作品検索フック。
 * Animeishi は作品マスタを持たず、検索語のたびにサーバー経由で Annict へ問い合わせる。
 *
 * 検索語が空のうちはシーズン検索になる。`season`（例: "2025-summer"）を渡すとその
 * シーズンで、渡さなければサーバーが今期を既定にして「今期アニメ」を返す。検索語が
 * あるときは title 検索が優先され、season は無視される。Annict 未連携のうちは無効化。
 *
 * 戻り値の `isConnected` は呼び出し側のソフトゲート（未連携時の連携誘導・手動更新の
 * ガード）に使う。`isSeason` は検索結果かシーズン一覧かの区別で、空状態の文言・件数
 * 表示の出し分けに使う。`hasNextPage` / `endCursor` は将来の追い読みに向けて公開する。
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

  const result = useQuery({
    queryKey: worksSearchQueryKey(trimmed, season),
    // 検索語が空でもシーズン一覧を出すため、連携済みなら常に有効化する。
    enabled: !!isSignedIn && isConnected,
    // 年/季節チップを切り替えると queryKey が変わり別クエリ扱いになるため、
    // 取得中に一覧が空表示へ切り替わらないよう前回の結果を保持する。
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<WorksSearchResponse> => {
      const headers = await getAuthHeaders(getToken);
      // Annict トークンは native ではヘッダで、Web ではサーバー(D1)側で解決される。
      const annictHeader = await buildAnnictAuthHeader();
      // title 省略時はシーズン検索。season 未指定ならサーバーが今期を既定にする。
      const queryParams = isSeason
        ? season
          ? { season }
          : {}
        : { title: trimmed };
      const res = await apiClient.works.search.$get(
        { query: queryParams },
        { headers: { ...headers, ...annictHeader } },
      );
      if (!res.ok) throw new Error("作品の検索に失敗しました");
      return res.json();
    },
  });

  return {
    ...result,
    // 一覧表示用に works だけを取り出した配列（後方互換のため data 名で公開）。
    data: result.data?.works,
    // 連携状態と次ページ情報。呼び出し側のソフトゲート/追い読みに使う。
    isConnected,
    isConnectionLoading,
    // 今期アニメ初期表示か検索結果かの区別（空状態の文言・件数表示の出し分け用）。
    isSeason,
    hasNextPage: result.data?.hasNextPage ?? false,
    endCursor: result.data?.endCursor ?? null,
  };
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
