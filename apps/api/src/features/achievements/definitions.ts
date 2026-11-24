// バッジ（視聴実績）の定義（issue #415）。閾値の見直しはここだけで済む。
// 獲得判定は D1 のデータ（watch_history / episode_records）から都度計算し、
// 獲得履歴はテーブルを持たない（クライアント側が前回既見との差分で
// 「新規獲得」を検出する）。

export const ACHIEVEMENT_KINDS = [
  "watch_count",
  "record_streak",
  "season_completion",
] as const;
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

// 視聴数バッジの段階（watch_history.state = 'WATCHED' の累計件数）。
export const WATCH_COUNT_TIERS = [10, 50, 100, 300, 500, 1000] as const;

// 連続記録バッジの段階（週単位。JST・月曜始まりの週で「1 話以上記録した」
// 週が途切れず続いた最長週数）。
export const RECORD_STREAK_TIERS = [4, 12, 26, 52] as const;

// 実績 ID。ティアを持つものは "<kind>_<threshold>"、単発のものは kind のまま。
export function achievementId(
  kind: AchievementKind,
  threshold: number | null,
): string {
  return threshold == null ? kind : `${kind}_${threshold}`;
}
