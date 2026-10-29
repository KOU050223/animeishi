import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { GRID_GAP } from "./animeListUtils";

/**
 * アニメ一覧画面の配色。light は紙ライクな暖色系、dark はその印象を保ちつつ
 * 暗い暖灰（stone 系）へ落とす。カードやチップは背景より一段明るい面にする。
 *
 * 直接参照するのではなく `useAnimeListStyles()` / `useAnimeListPalette()` 経由で
 * 現在スキームに対応する値を取る（判定元は dark: バリアントと同じ
 * RN の useColorScheme）。
 */
export type AnimeListPalette = {
  /** 画面のベース背景。 */
  screen: string;
  /** オレンジ系のセクションラベル（フィルタ行ラベル）。 */
  accent: string;
  /** 見出し・強調テキスト。 */
  title: string;
  /** 説明文・ラベル等の副テキスト。 */
  subtitle: string;
  /** 検索バー。 */
  searchBg: string;
  searchBorder: string;
  searchText: string;
  /** 検索バー内のアイコン・クリアボタン。 */
  searchIcon: string;
  clearButtonBg: string;
  clearIcon: string;
  /** 統計ピル（ink / gold / mint の 3 トーン）。 */
  statInkBg: string;
  statInkBorder: string;
  statGoldBg: string;
  statGoldBorder: string;
  statMintBg: string;
  statMintBorder: string;
  /** 白いチップ系ボタン（ソート・シーズン）。 */
  chipBg: string;
  chipBorder: string;
  /** 選択中チップは反転した塗りにする。 */
  chipActiveBg: string;
  chipActiveBorder: string;
  chipText: string;
  chipTextActive: string;
  chipDisabledBg: string;
  chipDisabledBorder: string;
  chipTextDisabled: string;
  /** 作品カード。 */
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  cardTitle: string;
  cardSubtitle: string;
  /** ポスター・スケルトンの代替面。 */
  skeleton: string;
  /** スケルトンのうち一段明るい部品（チップ型）。 */
  skeletonMuted: string;
  /** シーズン・ジャンルの小チップ。 */
  seasonChipBg: string;
  seasonChipText: string;
  genreChipBg: string;
  genreChipText: string;
  /** お気に入りボタン。 */
  favoriteBg: string;
  favoriteBorder: string;
  favoriteActiveBg: string;
  favoriteActiveBorder: string;
  favoriteIcon: string;
  favoriteIconActive: string;
  /** 空状態/エラーのアイコンを入れる白い箱。 */
  iconBoxBg: string;
  iconBoxBorder: string;
  /** エラー時は rose 系に変える。 */
  errorBoxBg: string;
  errorBoxBorder: string;
  errorIcon: string;
  /** 空状態の中性アイコン。 */
  stateIcon: string;
  /** ローディング中のスピナー（loadingMark 内）。 */
  spinner: string;
  /** 画面の主ボタン（再試行）。反転した塗りにする。 */
  primaryButtonBg: string;
  primaryButtonText: string;
};

const lightPalette: AnimeListPalette = {
  screen: "#f6f3ee",
  accent: "#7c2d12",
  title: "#111827",
  subtitle: "#64748b",
  searchBg: "#ffffff",
  searchBorder: "#e2e8f0",
  searchText: "#111827",
  searchIcon: "#64748b",
  clearButtonBg: "#f1f5f9",
  clearIcon: "#475569",
  statInkBg: "#f8fafc",
  statInkBorder: "#e2e8f0",
  statGoldBg: "#fffbeb",
  statGoldBorder: "#fde68a",
  statMintBg: "#ecfdf5",
  statMintBorder: "#bbf7d0",
  chipBg: "#ffffff",
  chipBorder: "#dbe4ee",
  chipActiveBg: "#111827",
  chipActiveBorder: "#111827",
  chipText: "#64748b",
  chipTextActive: "#ffffff",
  chipDisabledBg: "#f1f5f9",
  chipDisabledBorder: "#e2e8f0",
  chipTextDisabled: "#cbd5e1",
  cardBg: "#ffffff",
  cardBorder: "#e5e7eb",
  cardShadow: "#111827",
  cardTitle: "#111827",
  cardSubtitle: "#64748b",
  skeleton: "#e2e8f0",
  skeletonMuted: "#f1f5f9",
  seasonChipBg: "#fef3c7",
  seasonChipText: "#92400e",
  genreChipBg: "#f1f5f9",
  genreChipText: "#475569",
  favoriteBg: "#f8fafc",
  favoriteBorder: "#e2e8f0",
  favoriteActiveBg: "#fff1f2",
  favoriteActiveBorder: "#fecdd3",
  favoriteIcon: "#64748b",
  favoriteIconActive: "#e11d48",
  iconBoxBg: "#ffffff",
  iconBoxBorder: "#e5e7eb",
  errorBoxBg: "#fff1f2",
  errorBoxBorder: "#fecdd3",
  errorIcon: "#b42318",
  stateIcon: "#475569",
  spinner: "#111827",
  primaryButtonBg: "#111827",
  primaryButtonText: "#ffffff",
};

const darkPalette: AnimeListPalette = {
  screen: "#0c0a09",
  accent: "#fdba74",
  title: "#f5f5f4",
  subtitle: "#a8a29e",
  searchBg: "#292524",
  searchBorder: "#57534e",
  searchText: "#f5f5f4",
  searchIcon: "#a8a29e",
  clearButtonBg: "#44403c",
  clearIcon: "#d6d3d1",
  statInkBg: "#292524",
  statInkBorder: "#57534e",
  statGoldBg: "#451a03",
  statGoldBorder: "#92400e",
  statMintBg: "#022c22",
  statMintBorder: "#065f46",
  chipBg: "#292524",
  chipBorder: "#57534e",
  chipActiveBg: "#e7e5e4",
  chipActiveBorder: "#e7e5e4",
  chipText: "#a8a29e",
  chipTextActive: "#1c1917",
  chipDisabledBg: "#1c1917",
  chipDisabledBorder: "#44403c",
  chipTextDisabled: "#57534e",
  cardBg: "#1c1917",
  cardBorder: "#44403c",
  cardShadow: "#000000",
  cardTitle: "#f5f5f4",
  cardSubtitle: "#a8a29e",
  skeleton: "#44403c",
  skeletonMuted: "#57534e",
  seasonChipBg: "#451a03",
  seasonChipText: "#fbbf24",
  genreChipBg: "#292524",
  genreChipText: "#d6d3d1",
  favoriteBg: "#292524",
  favoriteBorder: "#57534e",
  favoriteActiveBg: "#4c0519",
  favoriteActiveBorder: "#9f1239",
  favoriteIcon: "#a8a29e",
  favoriteIconActive: "#fb7185",
  iconBoxBg: "#1c1917",
  iconBoxBorder: "#44403c",
  errorBoxBg: "#4c0519",
  errorBoxBorder: "#9f1239",
  errorIcon: "#f87171",
  stateIcon: "#a8a29e",
  spinner: "#e7e5e4",
  primaryButtonBg: "#e7e5e4",
  primaryButtonText: "#1c1917",
};

export const animeListPalettes = {
  light: lightPalette,
  dark: darkPalette,
} as const;

/** 現在スキームのアニメ一覧パレット。アイコン等、style 外で色が要る箇所向け。 */
export function useAnimeListPalette(): AnimeListPalette {
  const colorScheme = useColorScheme();
  return animeListPalettes[colorScheme === "dark" ? "dark" : "light"];
}

/** 現在スキームに対応する StyleSheet。パレット差し替え時だけ再生成する。 */
export function useAnimeListStyles() {
  const palette = useAnimeListPalette();
  return useMemo(() => createStyles(palette), [palette]);
}

function createStyles(p: AnimeListPalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: p.screen,
    },
    listContent: {
      rowGap: 12,
    },
    columnWrapper: {
      gap: GRID_GAP,
      justifyContent: "flex-start",
      marginBottom: GRID_GAP,
    },
    header: {
      gap: 12,
      marginBottom: 2,
    },
    searchBar: {
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 8,
      backgroundColor: p.searchBg,
      borderWidth: 1,
      borderColor: p.searchBorder,
      paddingHorizontal: 13,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: p.searchText,
      fontSize: 15,
      fontWeight: "600",
      paddingVertical: 13,
    },
    clearButton: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 15,
      backgroundColor: p.clearButtonBg,
    },
    statsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
    },
    statPill: {
      width: "31.5%",
      minWidth: 0,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    statPill_ink: {
      backgroundColor: p.statInkBg,
      borderColor: p.statInkBorder,
    },
    statPill_gold: {
      backgroundColor: p.statGoldBg,
      borderColor: p.statGoldBorder,
    },
    statPill_mint: {
      backgroundColor: p.statMintBg,
      borderColor: p.statMintBorder,
    },
    statValue: {
      color: p.title,
      fontSize: 14,
      fontWeight: "900",
    },
    statLabel: {
      marginTop: 1,
      color: p.subtitle,
      fontSize: 10,
      fontWeight: "700",
    },
    toolbar: {
      gap: 10,
    },
    toolbarTop: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
    },
    toolbarCopy: {
      flex: 1,
      minWidth: 0,
    },
    sectionLabel: {
      color: p.accent,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0,
    },
    resultText: {
      marginTop: 2,
      color: p.title,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "900",
    },
    sortGroup: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
    },
    sortGroupWide: {
      width: 360,
    },
    sortButton: {
      width: "49%",
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: p.chipBorder,
      backgroundColor: p.chipBg,
      paddingHorizontal: 10,
    },
    sortButtonActive: {
      borderColor: p.title,
      backgroundColor: p.chipBg,
    },
    sortText: {
      color: p.subtitle,
      fontSize: 12,
      fontWeight: "800",
    },
    sortTextActive: {
      color: p.title,
    },
    filterBar: {
      gap: 8,
    },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    filterRowLabel: {
      width: 34,
      color: p.accent,
      fontSize: 11,
      fontWeight: "800",
    },
    filterScroll: {
      flexDirection: "row",
      gap: 6,
      paddingRight: 6,
    },
    filterChip: {
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: p.chipBorder,
      backgroundColor: p.chipBg,
      paddingHorizontal: 12,
    },
    filterChipActive: {
      borderColor: p.chipActiveBorder,
      backgroundColor: p.chipActiveBg,
    },
    filterChipText: {
      color: p.chipText,
      fontSize: 12,
      fontWeight: "800",
    },
    filterChipTextActive: {
      color: p.chipTextActive,
    },
    filterChipDisabled: {
      backgroundColor: p.chipDisabledBg,
      borderColor: p.chipDisabledBorder,
    },
    filterChipTextDisabled: {
      color: p.chipTextDisabled,
    },
    card: {
      flexDirection: "row",
      gap: 13,
      borderRadius: 8,
      backgroundColor: p.cardBg,
      borderWidth: 1,
      borderColor: p.cardBorder,
      padding: 10,
      shadowColor: p.cardShadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.05,
      shadowRadius: 18,
      elevation: 2,
    },
    poster: {
      width: 68,
      height: 92,
      borderRadius: 6,
      backgroundColor: p.skeleton,
    },
    posterPlaceholder: {
      width: 68,
      height: 92,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      borderRadius: 6,
      borderWidth: 1,
    },
    posterPlaceholderAccent: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 4,
    },
    posterInitial: {
      fontSize: 25,
      lineHeight: 30,
      fontWeight: "900",
    },
    posterFallbackLabel: {
      marginTop: 2,
      fontSize: 8,
      fontWeight: "900",
    },
    cardBody: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      minWidth: 0,
      color: p.cardTitle,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "900",
      letterSpacing: 0,
    },
    metaRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    seasonChip: {
      minHeight: 25,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 7,
      backgroundColor: p.seasonChipBg,
      paddingHorizontal: 8,
    },
    seasonText: {
      color: p.seasonChipText,
      fontSize: 11,
      fontWeight: "900",
    },
    genreChip: {
      maxWidth: 92,
      minHeight: 25,
      justifyContent: "center",
      borderRadius: 7,
      backgroundColor: p.genreChipBg,
      paddingHorizontal: 8,
    },
    genreText: {
      color: p.genreChipText,
      fontSize: 11,
      fontWeight: "800",
    },
    moreGenres: {
      color: p.subtitle,
      fontSize: 11,
      fontWeight: "900",
    },
    favoriteButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      backgroundColor: p.favoriteBg,
      borderWidth: 1,
      borderColor: p.favoriteBorder,
    },
    favoriteButtonActive: {
      backgroundColor: p.favoriteActiveBg,
      borderColor: p.favoriteActiveBorder,
    },
    // 作品一覧のローディングスケルトン（AnimeListSkeleton）。実カードと同じ
    // 行方向レイアウト（ポスター + テキスト行）を muted 色で敷く。
    skeletonContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 12,
      columnGap: GRID_GAP,
    },
    skeletonPoster: {
      width: 68,
      height: 92,
      borderRadius: 6,
      backgroundColor: p.skeleton,
    },
    skeletonBody: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
      gap: 8,
    },
    skeletonLine: {
      width: "100%",
      height: 12,
      borderRadius: 6,
      backgroundColor: p.skeleton,
    },
    skeletonLineShort: {
      width: "55%",
    },
    skeletonChip: {
      marginTop: 2,
      width: 86,
      height: 25,
      borderRadius: 7,
      backgroundColor: p.skeletonMuted,
    },
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 30,
      paddingVertical: 54,
    },
    stateScreen: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.screen,
      paddingHorizontal: 32,
    },
    loadingMark: {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: p.iconBoxBg,
      borderWidth: 1,
      borderColor: p.iconBoxBorder,
    },
    stateIcon: {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: p.iconBoxBg,
      borderWidth: 1,
      borderColor: p.iconBoxBorder,
    },
    errorIcon: {
      backgroundColor: p.errorBoxBg,
      borderColor: p.errorBoxBorder,
    },
    stateTitle: {
      marginTop: 16,
      color: p.title,
      textAlign: "center",
      fontSize: 19,
      lineHeight: 25,
      fontWeight: "900",
    },
    stateCopy: {
      marginTop: 7,
      color: p.subtitle,
      textAlign: "center",
      fontSize: 13,
      lineHeight: 20,
      fontWeight: "600",
    },
    primaryButton: {
      marginTop: 20,
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 8,
      backgroundColor: p.primaryButtonBg,
      paddingHorizontal: 20,
    },
    primaryButtonText: {
      color: p.primaryButtonText,
      fontSize: 14,
      fontWeight: "900",
    },
    emptyTitle: {
      marginTop: 14,
      color: p.title,
      fontSize: 18,
      fontWeight: "900",
    },
    emptyCopy: {
      marginTop: 7,
      color: p.subtitle,
      textAlign: "center",
      fontSize: 13,
      lineHeight: 20,
      fontWeight: "600",
    },
  });
}
