import type { AnimeTitle } from "@/lib/useAnimeList";

export const SEASONS: Record<string, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  // Annict は秋を autumn で返すが、過去データ/表記ゆれの fall も同じ「秋」に寄せる。
  fall: "秋",
  winter: "冬",
};

export const GRID_GAP = 14;

// シーズン絞り込みの並び順（API の season 文字列 = "<year>-<key>"）。
export const SEASON_KEYS = ["winter", "spring", "summer", "autumn"] as const;
export type SeasonKey = (typeof SEASON_KEYS)[number];

// シーズン絞り込みで選べる期。"all" はその年の 4 クール全部（通年指定で、
// API には年だけの season 文字列 "2026" を送る。issue #346）。
export const SEASON_FILTER_ALL = "all";
export type SeasonFilterKey = SeasonKey | typeof SEASON_FILTER_ALL;

/**
 * JST（UTC+9）基準の現在の年と Annict シーズンキー
 * （1-3:winter / 4-6:spring / 7-9:summer / 10-12:autumn）。
 * 「今期」の判定は API の currentAnnictSeason と同じく JST で行う。
 * 端末のローカル時刻のままだと四半期境界で API とずれるため。
 */
export function currentSeason(now: Date = new Date()): {
  year: number;
  key: SeasonKey;
} {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    key: SEASON_KEYS[Math.floor(jst.getUTCMonth() / 3)],
  };
}

/**
 * API に渡す season 文字列を組み立てる（例: "2026-spring"）。
 * 通年指定（"all"）は年だけの文字列（例: "2026"）。API 側でその年の
 * 4 クール分の seasons に展開される（issue #346）。
 */
export function toSeasonParam(year: number, key: SeasonFilterKey): string {
  return key === SEASON_FILTER_ALL ? `${year}` : `${year}-${key}`;
}

/** シーズン選択チップの表示ラベル（例: "2026年 春"、通年は "2026年"）。 */
export function formatSeasonLabel(year: number, key: SeasonFilterKey): string {
  return key === SEASON_FILTER_ALL
    ? `${year}年`
    : `${year}年 ${SEASONS[key] ?? ""}`;
}

/**
 * 年ピッカーで遡れる下限。Annict のシーズン別アーカイブは 1890 年まで遡れる
 * （annict.com/works/<year>-<season>）。
 */
export const SEASON_PICKER_MIN_YEAR = 1890;

/** 今期から先に選べるシーズン数（来期・再来期）。 */
const FUTURE_SEASON_COUNT = 2;

/** (year, key) を offset シーズン分ずらした結果を返す（負の offset で過去へ）。 */
export function shiftSeason(
  year: number,
  key: SeasonKey,
  offset: number,
): { year: number; key: SeasonKey } {
  const total = year * SEASON_KEYS.length + SEASON_KEYS.indexOf(key) + offset;
  const index =
    ((total % SEASON_KEYS.length) + SEASON_KEYS.length) % SEASON_KEYS.length;
  return {
    year: Math.floor(total / SEASON_KEYS.length),
    key: SEASON_KEYS[index],
  };
}

/** 選択可能な最も先のシーズン（今期 + FUTURE_SEASON_COUNT）。 */
export function maxSelectableSeason(now: Date = new Date()): {
  year: number;
  key: SeasonKey;
} {
  const current = currentSeason(now);
  return shiftSeason(current.year, current.key, FUTURE_SEASON_COUNT);
}

/**
 * 年ピッカーに出す年リストを新しい順で返す。
 * 先頭は maxSelectableSeason の年（来期・再来期が翌年になることもある）、
 * 末尾は Annict アーカイブの最古年。
 */
export function seasonPickerYears(now: Date = new Date()): number[] {
  const maxYear = maxSelectableSeason(now).year;
  return Array.from(
    { length: maxYear - SEASON_PICKER_MIN_YEAR + 1 },
    (_, i) => maxYear - i,
  );
}

/**
 * その年で選択可能なシーズンキーを冬→春→夏→秋の順で返す。
 * 上限年は今期+2 シーズンまで、それより昔の年は全シーズン、
 * 上限年より未来は空配列。
 */
export function selectableSeasonKeys(
  year: number,
  now: Date = new Date(),
): SeasonKey[] {
  const max = maxSelectableSeason(now);
  if (year > max.year) return [];
  if (year === max.year) {
    return SEASON_KEYS.slice(0, SEASON_KEYS.indexOf(max.key) + 1);
  }
  return [...SEASON_KEYS];
}

/**
 * (year, key) の前後シーズンの season 文字列を返す（プリフェッチ用。issue #173）。
 * 選択上限（今期+2 シーズン）より先や Annict アーカイブ下限（SEASON_PICKER_MIN_YEAR）
 * より前は UI から選べないため含めない。
 */
export function adjacentSeasonParams(
  year: number,
  key: SeasonFilterKey,
  now: Date = new Date(),
): string[] {
  // 通年指定は年単位の前後をプリフェッチする（各シーズンではなく年クエリ）。
  if (key === SEASON_FILTER_ALL) {
    const params: string[] = [];
    if (year - 1 >= SEASON_PICKER_MIN_YEAR) params.push(`${year - 1}`);
    if (year + 1 <= maxSelectableSeason(now).year) params.push(`${year + 1}`);
    return params;
  }
  const prev = shiftSeason(year, key, -1);
  const next = shiftSeason(year, key, 1);
  const params: string[] = [];
  if (prev.year >= SEASON_PICKER_MIN_YEAR) {
    params.push(toSeasonParam(prev.year, prev.key));
  }
  if (selectableSeasonKeys(next.year, now).includes(next.key)) {
    params.push(toSeasonParam(next.year, next.key));
  }
  return params;
}

export const POSTER_PALETTES = [
  { bg: "#fff7ed", border: "#fed7aa", accent: "#f97316", text: "#7c2d12" },
  { bg: "#eff6ff", border: "#bfdbfe", accent: "#2563eb", text: "#1e3a8a" },
  { bg: "#fdf2f8", border: "#fbcfe8", accent: "#db2777", text: "#831843" },
  { bg: "#ecfdf5", border: "#bbf7d0", accent: "#059669", text: "#064e3b" },
  { bg: "#f8fafc", border: "#cbd5e1", accent: "#475569", text: "#0f172a" },
];

// light の POSTER_PALETTES と同じ順序・同じ色相の暗色版。
// パステル背景のままだと dark で眩しいため、背景は 950、文字は 200 系に落とす。
const POSTER_PALETTES_DARK = [
  { bg: "#431407", border: "#9a3412", accent: "#fb923c", text: "#fed7aa" },
  { bg: "#172554", border: "#1d4ed8", accent: "#60a5fa", text: "#bfdbfe" },
  { bg: "#500724", border: "#be185d", accent: "#f472b6", text: "#fbcfe8" },
  { bg: "#022c22", border: "#047857", accent: "#34d399", text: "#a7f3d0" },
  { bg: "#0f172a", border: "#334155", accent: "#94a3b8", text: "#e2e8f0" },
];

export function formatYearSeason(
  year: number | null | undefined,
  season: string | null | undefined,
) {
  if (!year) return "";
  return `${year}年${season ? (SEASONS[season] ?? "") : ""}`;
}

/**
 * 作品の放送シーズン表示（例: "2026年 春"）。seasonName は "2026-spring"
 * 形式なので季節キーだけを取り出して formatYearSeason に渡す。
 */
export function formatWorkSeason(
  work: Pick<AnimeTitle, "seasonYear" | "seasonName">,
) {
  return formatYearSeason(
    work.seasonYear,
    work.seasonName?.includes("-")
      ? work.seasonName.split("-")[1]
      : work.seasonName,
  );
}

export function getPosterInitial(title: string) {
  return Array.from(title.trim())[0] ?? "A";
}

export function getPosterPalette(
  title: string,
  scheme: "light" | "dark" = "light",
) {
  const index = Array.from(title).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const palettes = scheme === "dark" ? POSTER_PALETTES_DARK : POSTER_PALETTES;
  return palettes[index % palettes.length];
}

export function getAnimeListLayout(width: number) {
  const numColumns =
    width >= 1440 ? 4 : width >= 1100 ? 3 : width >= 900 ? 2 : 1;
  const contentWidth =
    numColumns === 1
      ? Math.min(Math.max(width - 36, 0), 354)
      : Math.min(Math.max(width - 64, 0), 1600);
  const cardWidth =
    numColumns === 1
      ? contentWidth
      : (contentWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  return {
    contentWidth,
    cardWidth,
    numColumns,
    isWide: contentWidth >= 900,
  };
}
