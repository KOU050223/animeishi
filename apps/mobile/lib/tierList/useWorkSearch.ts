import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
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
 */
export function useWorkSearch(query: string) {
  const { getToken, isSignedIn } = useAuth();
  // 検索は API 側で X-Annict-Token 必須。未連携のうちは 401 になるだけなので無効化する。
  const { isConnected } = useAnnictConnection();
  const trimmed = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const result = useQuery({
    queryKey: ["tier-list", "work-search", trimmed] as const,
    enabled: !!isSignedIn && isConnected && trimmed.length > 0,
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
    /** デバウンス後の検索語が空かどうか。空の間は検索が発火しない。 */
    hasQuery: trimmed.length > 0,
  };
}
