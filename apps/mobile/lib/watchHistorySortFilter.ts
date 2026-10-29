import type { WatchState } from "./watchStatusLabels";

// 視聴履歴セクションのソート・絞り込み（issue #345）。
// コンポーネントから切り離した純関数にし、vitest（*.unit.test.ts）で検証する。

// ソートキー。updatedAt は API が返す既定の並び（watch_history.updated_at 降順）。
export const WATCH_HISTORY_SORT_KEYS = [
  "updatedAt",
  "seasonYear",
  "watchersCount",
] as const;
export type WatchHistorySortKey = (typeof WATCH_HISTORY_SORT_KEYS)[number];

export const WATCH_HISTORY_SORT_LABELS: Record<WatchHistorySortKey, string> = {
  updatedAt: "更新日順",
  seasonYear: "放送年順",
  watchersCount: "視聴者数順",
};

// 放送年代フィルタの選択肢。数値は年代の先頭年（例: 2020 = 2020年代）、
// "unknown" は放送年未設定の作品だけを示す特別値。
export type WatchHistoryDecade = number | "unknown";

export type WatchHistoryFilters = {
  /** null は絞り込まない（すべての年代）。 */
  decade: WatchHistoryDecade | null;
  /** 空配列は絞り込まない（すべての状態）。複数選択可。 */
  states: readonly WatchState[];
};

export const NO_WATCH_HISTORY_FILTERS: WatchHistoryFilters = {
  decade: null,
  states: [],
};

// ソート・絞り込みの入力に必要な最小限のフィールド。
type WatchHistoryEntry = {
  state: WatchState;
  seasonYear: number | null;
  watchersCount: number | null;
};

export function isWatchHistoryFilterActive(
  filters: WatchHistoryFilters,
): boolean {
  return filters.decade !== null || filters.states.length > 0;
}

/** 放送年（例: 2024）を年代の先頭年（例: 2020）に丸める。 */
export function yearToDecade(year: number): number {
  return Math.floor(year / 10) * 10;
}

/**
 * 一覧に出る作品から年代フィルタの選択肢を作る。
 * 出現する年代だけを新しい順に並べ、放送年が未設定の作品が
 * あるときだけ末尾に "unknown" を足す。
 */
export function collectWatchHistoryDecades(
  items: Pick<WatchHistoryEntry, "seasonYear">[],
): WatchHistoryDecade[] {
  const decades = new Set<number>();
  let hasUnknown = false;
  for (const item of items) {
    if (item.seasonYear == null) hasUnknown = true;
    else decades.add(yearToDecade(item.seasonYear));
  }
  const sorted = [...decades].sort((a, b) => b - a);
  return hasUnknown ? [...sorted, "unknown"] : sorted;
}

/** 絞り込みを適用した一覧を返す。フィルタ無効時は入力をそのまま返す。 */
export function filterWatchHistory<T extends WatchHistoryEntry>(
  items: T[],
  filters: WatchHistoryFilters,
): T[] {
  return items.filter((item) => {
    if (filters.states.length > 0 && !filters.states.includes(item.state)) {
      return false;
    }
    if (filters.decade === "unknown") return item.seasonYear == null;
    if (filters.decade != null) {
      return (
        item.seasonYear != null &&
        yearToDecade(item.seasonYear) === filters.decade
      );
    }
    return true;
  });
}

/**
 * ソートを適用した一覧を返す。updatedAt は API の並び（更新日降順）を
 * そのまま使うため並べ替えない。それ以外は値の降順で、値を持たない
 * （未取得の）作品は末尾に寄せる。同値の並びは入力順を維持する
 * （= 更新日降順がタイブレークになる）。
 */
export function sortWatchHistory<T extends WatchHistoryEntry>(
  items: T[],
  sortKey: WatchHistorySortKey,
): T[] {
  if (sortKey === "updatedAt") return items;
  const valueOf = (item: T) =>
    sortKey === "seasonYear" ? item.seasonYear : item.watchersCount;
  return [...items].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}
