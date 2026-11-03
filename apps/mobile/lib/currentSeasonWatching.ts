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

/**
 * 視聴履歴から「今期視聴中」だけを取り出す（issue #353）。
 * 今期の判定は currentSeason と同じ JST 基準。入力の並び（更新日降順）は維持する。
 */
export function filterCurrentSeasonWatching<T extends WatchingWork>(
  items: readonly T[],
  now: Date = new Date(),
): T[] {
  const { year, key } = currentSeason(now);
  const current = `${year}-${key}`;
  return items.filter(
    (item) =>
      item.state === "WATCHING" &&
      item.seasonName != null &&
      normalizeSeasonName(item.seasonName) === current,
  );
}
