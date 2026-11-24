// --- searchWorks（シーズン検索・初期表示の「今期アニメ」） ---

// Annict のシーズン区分（1-3:winter / 4-6:spring / 7-9:summer / 10-12:autumn）。
// searchWorks の seasons 引数は "2026-spring" のような "<年>-<シーズン>" 形式。
const ANNICT_SEASON_NAMES = ["winter", "spring", "summer", "autumn"] as const;

/**
 * 指定日付（既定は現在）の Annict シーズン文字列（例: "2026-spring"）を返す。
 * 「今期アニメ」を searchWorks(seasons:) で引くためのキーに使う。
 */
export function currentAnnictSeason(now: Date = new Date()): string {
  // Annict は日本のサービスなので「今期」は JST（UTC+9）基準で判定する。
  // UTC のままだと四半期境界（例: 4/1 00:00〜08:59 JST）で 1 つ前のシーズンを返してしまう。
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  // 0-11 の月を 3 か月区切りのシーズンインデックス（0-3）に丸める。
  const season = ANNICT_SEASON_NAMES[Math.floor(jst.getUTCMonth() / 3)];
  return `${year}-${season}`;
}

/**
 * シーズン文字列（例: "2026-spring"）を searchWorks の seasons 引数に展開する。
 * "2026-spring" はそのまま 1 要素で、年のみ（"2026"）はその年の 4 クール分に
 * 展開する（放送年での絞り込み。searchWorks に seasonYears 引数は無いため
 * seasons で表現する。issue #346）。
 */
export function expandSeasonQuery(season: string): string[] {
  if (/^\d{4}$/.test(season)) {
    return ANNICT_SEASON_NAMES.map((key) => `${season}-${key}`);
  }
  return [season];
}
