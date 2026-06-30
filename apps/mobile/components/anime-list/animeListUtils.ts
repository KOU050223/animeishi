import { useMemo } from "react";
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

/** 現在の Annict シーズンキー（1-3:winter / 4-6:spring / 7-9:summer / 10-12:autumn）。 */
export function currentSeasonKey(now: Date = new Date()): SeasonKey {
  return SEASON_KEYS[Math.floor(now.getMonth() / 3)];
}

/** API に渡す season 文字列（例: "2026-spring"）を組み立てる。 */
export function toSeasonParam(year: number, key: SeasonKey): string {
  return `${year}-${key}`;
}

/** シーズン選択チップの表示ラベル（例: "2026年 春"）。 */
export function formatSeasonLabel(year: number, key: SeasonKey): string {
  return `${year}年 ${SEASONS[key] ?? ""}`;
}

/**
 * 絞り込み用の年リストを新しい順で返す（今年から count 年分さかのぼる）。
 */
export function recentYears(count = 12, now: Date = new Date()): number[] {
  const thisYear = now.getFullYear();
  return Array.from({ length: count }, (_, i) => thisYear - i);
}

export const POSTER_PALETTES = [
  { bg: "#fff7ed", border: "#fed7aa", accent: "#f97316", text: "#7c2d12" },
  { bg: "#eff6ff", border: "#bfdbfe", accent: "#2563eb", text: "#1e3a8a" },
  { bg: "#fdf2f8", border: "#fbcfe8", accent: "#db2777", text: "#831843" },
  { bg: "#ecfdf5", border: "#bbf7d0", accent: "#059669", text: "#064e3b" },
  { bg: "#f8fafc", border: "#cbd5e1", accent: "#475569", text: "#0f172a" },
];

export function useAnimeStats(data: AnimeTitle[] | undefined) {
  return useMemo(() => {
    const list = data ?? [];
    const years = list
      .map((item) => item.seasonYear)
      .filter((year): year is number => typeof year === "number");
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;

    return {
      total: list.length,
      yearRange:
        minYear && maxYear
          ? minYear === maxYear
            ? `${minYear}`
            : `${minYear}-${maxYear}`
          : "-",
      genreCount: 0,
    };
  }, [data]);
}

export function formatYearSeason(
  year: number | null | undefined,
  season: string | null | undefined,
) {
  if (!year) return "";
  return `${year}年${season ? (SEASONS[season] ?? "") : ""}`;
}

export function getPosterInitial(title: string) {
  return Array.from(title.trim())[0] ?? "A";
}

export function getPosterPalette(title: string) {
  const index = Array.from(title).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  return POSTER_PALETTES[index % POSTER_PALETTES.length];
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
