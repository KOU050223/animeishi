// 放送年 → 年内クール順の比較。視聴履歴の「放送年順」とアニメ一覧の
// 「年度」ソートで共有する（issue #472）。

// Annict のクールは 1-3月=winter / 4-6月=spring / 7-9月=summer /
// 10-12月=autumn。"fall" は表記ゆれで秋として扱う（animeListUtils.SEASONS に倣う）。
const SEASON_RANK: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  autumn: 3,
  fall: 3,
};

// 比較の入力に必要な最小限のフィールド。
export type BroadcastSeasonEntry = {
  seasonYear: number | null;
  seasonName?: string | null;
};

function broadcastSeasonRank(
  seasonName: string | null | undefined,
): number | null {
  if (seasonName == null) return null;
  // "2026-spring" 形式から季節部分だけを取る。ハイフンが無い値は
  // 全体をシーズン名として解釈する（formatWorkSeason と同じパース）。
  const season = seasonName.includes("-")
    ? seasonName.split("-")[1]
    : seasonName;
  return SEASON_RANK[season] ?? null;
}

/**
 * Array#sort の comparator。
 *
 * シーズン未設定は向きに関わらず同じ年の末尾に置く（昇順で未設定が
 * 先頭に来ないよう、順位の反転ではなく専用の後置きにする）。
 * seasonYear null は最小年扱いで、降順で末尾・昇順で先頭に寄る
 * 従来の並び（sortWatchHistory の末尾寄せ・sortAnimeList の `?? 0`）を維持する。
 */
export function compareBroadcastSeason(
  a: BroadcastSeasonEntry,
  b: BroadcastSeasonEntry,
  order: "asc" | "desc",
): number {
  const ay = a.seasonYear ?? Number.NEGATIVE_INFINITY;
  const by = b.seasonYear ?? Number.NEGATIVE_INFINITY;
  if (ay !== by) return order === "asc" ? ay - by : by - ay;
  const as = broadcastSeasonRank(a.seasonName);
  const bs = broadcastSeasonRank(b.seasonName);
  if (as == null && bs == null) return 0;
  if (as == null) return 1;
  if (bs == null) return -1;
  return order === "asc" ? as - bs : bs - as;
}
