import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";
import { getAnnictToken, useAnnictConnection } from "@/lib/annict";

// Annict アクセストークンを運ぶヘッダ名（API の requireAnnictToken と対応）。
const ANNICT_TOKEN_HEADER = "X-Annict-Token";

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
// 検索語が空のときは「今期アニメ」（season 指定）を表す固定キーを使う。
export const ANIME_LIST_QUERY_KEY = ["works", "search"] as const;

const worksSearchQueryKey = (query: string) =>
  [...ANIME_LIST_QUERY_KEY, query === "" ? "__season__" : query] as const;

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
 * 検索語が空のうちは「今期アニメ」（サーバーが season を既定にしたシーズン検索）を
 * 初期表示として取得する。Annict 未連携のうちはクエリを無効化する。
 *
 * 戻り値の `isConnected` は呼び出し側のソフトゲート（未連携時の連携誘導・手動更新の
 * ガード）に使う。`isSeason` は検索結果か今期アニメ初期表示かの区別で、空状態の
 * 文言出し分けに使う。`hasNextPage` / `endCursor` は将来の追い読みに向けて公開する。
 */
export function useAnimeList(query: string) {
  const { getToken, isSignedIn } = useAuth();
  // 検索は API 側で X-Annict-Token 必須。未連携のうちは 401 になるだけなので無効化する。
  // isConnectionLoading は SecureStore 読み込み中の判定。連携済みでも読み込み中は
  // isConnected=false になるため、呼び出し側はこの間ソフトゲートを出さない。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();
  // 入力のたびに Annict を叩かないよう、検索語が落ち着いてから発火する。
  const trimmed = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  // 検索語が空なら「今期アニメ」を取りに行く（title を送らず season をサーバー既定に委ねる）。
  const isSeason = trimmed.length === 0;

  const result = useQuery({
    queryKey: worksSearchQueryKey(trimmed),
    // 検索語が空でも今期アニメを出すため、連携済みなら常に有効化する。
    enabled: !!isSignedIn && isConnected,
    queryFn: async (): Promise<WorksSearchResponse> => {
      const headers = await getAuthHeaders(getToken);
      const annictToken = await getAnnictToken();
      if (!annictToken) throw new Error("Annict 連携が必要です");
      // title 省略時はサーバーが今期シーズンを既定にしてシーズン検索を返す。
      const res = await apiClient.works.search.$get(
        { query: isSeason ? {} : { title: trimmed } },
        { headers: { ...headers, [ANNICT_TOKEN_HEADER]: annictToken } },
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
