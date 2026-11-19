import { currentSeason } from "@/components/anime-list/animeListUtils";
import type { WatchState } from "@/lib/watchStatusLabels";

type WatchingWork = {
  state: WatchState;
  seasonName: string | null;
};

// Annict の seasonName は "<year>-<season>" 形式だが、秋は autumn / fall の
// 両方がデータに混在する。今期判定は SEASON_KEYS（autumn）で行うため、
// 作品側の fall を揃える。
function normalizeSeasonName(seasonName: string): string {
  return seasonName.replace(/-fall$/, "-autumn");
}

// 指定シーズン（"2026-autumn" 形式）の視聴中作品だけに絞る。
// API が更新日時降順で返すので、ここでは絞り込みだけして並び替えはしない。
export function filterWatchingBySeason<T extends WatchingWork>(
  items: readonly T[],
  season: string,
): T[] {
  return items.filter(
    (item) =>
      item.state === "WATCHING" &&
      item.seasonName != null &&
      normalizeSeasonName(item.seasonName) === season,
  );
}

// 今期の判定はアニメ一覧の currentSeason と同じ JST 基準に揃える（issue #353）。
export function filterCurrentSeasonWatching<T extends WatchingWork>(
  items: readonly T[],
  now: Date = new Date(),
): T[] {
  const { year, key } = currentSeason(now);
  return filterWatchingBySeason(items, `${year}-${key}`);
}
