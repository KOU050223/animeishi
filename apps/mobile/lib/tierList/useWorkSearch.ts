import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";

// 検索語入力のたびに Annict へ問い合わせないためのデバウンス時間（ms）。
// useAnimeList と同じ値に揃える。
const SEARCH_DEBOUNCE_MS = 300;

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
 * tier 表へ手動追加する作品を探すためのタイトル検索（issue #168）。
 *
 * /works/search は title 省略時にシーズン検索へフォールバックするが、
 * ここでは「シーズン候補に載らない作品を探す」用途なので、検索語が
 * 空の間はクエリ自体を無効化して発火させない。
 * タイトル検索は先頭ページのみ取得する（広い語で全件走査すると際限がない。
 * useAnimeList と同じ方針）。
 *
 * enabled: シートが閉じている等で検索自体を止めたいときに false を渡す。
 * 空クエリを渡すだけだとデバウンス済みの旧語が残り続け、閉じた後も
 * 旧語のクエリが有効なまま refetch 等で再フェッチされうるため。
 */
export function useWorkSearch(query: string, enabled = true) {
  const { getToken, isSignedIn } = useAuth();
  // 検索は API 側で X-Annict-Token 必須。未連携のうちは 401 になるだけなので無効化する。
  const { isConnected } = useAnnictConnection();
  const trimmed = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const result = useQuery({
    queryKey: ["tier-list", "work-search", trimmed] as const,
    // `query === trimmed` の一致も条件に入れる。ずれている間（入力直後の
    // デバウンス待ちや、シートを閉じてクエリを空にした直後）はクエリキーの
    // 旧語で有効なまま残り、refetch / 再マウントで余計なリクエストが出るため。
    enabled:
      enabled &&
      !!isSignedIn &&
      isConnected &&
      trimmed.length > 0 &&
      query.trim() === trimmed,
    // 語を変えた直後の取得中に一覧が空表示へ切り替わらないよう前回の結果を保持する。
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      // Annict トークンは native ではヘッダで、Web ではサーバー(D1)側で解決される。
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works.search.$get(
        { query: { title: trimmed } },
        {
          headers: { Authorization: `Bearer ${token}`, ...annictHeader },
        },
      );
      if (!res.ok) {
        throw new ApiRequestError(res.status, "作品の検索に失敗しました");
      }
      return res.json();
    },
  });

  return {
    ...result,
    works: result.data?.works ?? [],
    /** 現在の入力に検索語があるか。空の間は検索が発火しない。 */
    hasQuery: query.trim().length > 0,
    /** 取得した先頭ページの先にまだ結果があるか（タイトル検索は追い読みしない）。 */
    hasMore: result.data?.hasNextPage ?? false,
    /**
     * 表示中の結果が現在の入力の検索語と一致しないか（デバウンス待ちか、
     * keepPreviousData による前の語の仮表示中）。一覧の表示自体は継続して
     * よいが、追加などの確定操作はこの間だけ無効にする。
     */
    resultsStale: query.trim() !== trimmed || result.isPlaceholderData,
  };
}
