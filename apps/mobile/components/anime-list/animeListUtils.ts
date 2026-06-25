import { useMemo } from "react";
import type { AnimeTitle } from "@/lib/useAnimeList";

export const SEASONS: Record<string, string> = {
  spring: "春",
  summer: "夏",
  fall: "秋",
  winter: "冬",
};

export const GRID_GAP = 14;

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
      .map((item) => item.year)
      .filter((year): year is number => typeof year === "number");
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    const genres = new Set(list.flatMap((item) => item.genres ?? []));

    return {
      total: list.length,
      yearRange:
        minYear && maxYear
          ? minYear === maxYear
            ? `${minYear}`
            : `${minYear}-${maxYear}`
          : "-",
      genreCount: genres.size,
    };
  }, [data]);
}

export function formatYearSeason(
  year: number,
  season: string | null | undefined,
) {
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
