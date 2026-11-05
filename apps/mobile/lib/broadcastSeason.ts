// 放送シーズン（Annict Work.seasonName）を使った「年 → 年内クール」順の
// 比較。視聴履歴の「放送年順」とアニメ一覧の「年度」ソートで共有する
// （issue #472）。

// 年内の放送順。Annict のクールは 1-3月=winter / 4-6月=spring /
// 7-9月=summer / 10-12月=autumn（animeListUtils の SEASON_KEYS と同じ順）。
// "fall" は表記ゆれで秋として扱う（同じく animeListUtils.SEASONS に倣う）。
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

/**
 * seasonName（"2026-spring" 形式）から年内の放送順位を取る。
 * ハイフンが無い値は全体をシーズン名として解釈する（表示用の
 * formatWorkSeason と同じパース）。未設定・未知のシーズン名は null。
 */
function broadcastSeasonRank(
  seasonName: string | null | undefined,
): number | null {
  if (seasonName == null) return null;
  const season = seasonName.includes("-")
    ? seasonName.split("-")[1]
    : seasonName;
  return SEASON_RANK[season] ?? null;
}

/**
 * 放送年 → 年内シーズン順の比較関数（Array#sort の comparator）。
 * 年が同じなら年内の放送順（asc: 冬→春→夏→秋 / desc: その逆）で比べる。
 *
 * シーズン未設定（seasonName 無し・Annict が返さない形式）は向きに
 * 関わらず同じ年の末尾に置く（昇順で未設定が先頭に来ないよう、
 * 順位の反転ではなく専用の後置きにする）。
 * 放送年そのものが未設定（seasonYear null）は最小年として扱い、
 * 降順で末尾・昇順で先頭に寄る従来の並びを維持する。
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
