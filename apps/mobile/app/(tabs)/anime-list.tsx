import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAnimeList, useFilteredAnimeList } from "@/lib/useAnimeList";
import type { AnimeTitle, SortKey, SortOrder } from "@/lib/useAnimeList";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";

const SEASONS: Record<string, string> = {
  spring: "春",
  summer: "夏",
  fall: "秋",
  winter: "冬",
};

const GRID_GAP = 14;
const POSTER_PALETTES = [
  { bg: "#fff7ed", border: "#fed7aa", accent: "#f97316", text: "#7c2d12" },
  { bg: "#eff6ff", border: "#bfdbfe", accent: "#2563eb", text: "#1e3a8a" },
  { bg: "#fdf2f8", border: "#fbcfe8", accent: "#db2777", text: "#831843" },
  { bg: "#ecfdf5", border: "#bbf7d0", accent: "#059669", text: "#064e3b" },
  { bg: "#f8fafc", border: "#cbd5e1", accent: "#475569", text: "#0f172a" },
];

export default function AnimeListScreen() {
  const { data, isLoading, isError, refetch } = useAnimeList();
  const favoriteIds = useFavoriteIds();
  const { toggle, isPending: isToggling } = useToggleFavorite(favoriteIds);

  return (
    <AnimeListContent
      data={data}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      favoriteIds={favoriteIds}
      toggleFavorite={toggle}
      isToggling={isToggling}
    />
  );
}

export function AnimeListContent({
  data,
  isLoading,
  isError,
  refetch,
  favoriteIds,
  toggleFavorite,
  isToggling,
}: {
  data: AnimeTitle[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown> | unknown;
  favoriteIds: Set<number>;
  toggleFavorite: (animeId: number) => void;
  isToggling: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { contentWidth, cardWidth, numColumns, isWide } =
    getAnimeListLayout(width);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const [refreshing, setRefreshing] = useState(false);
  const filtered = useFilteredAnimeList(data, query, sortKey, sortOrder);
  const stats = useAnimeStats(data);

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  }

  if (isLoading) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.loadingMark}>
          <ActivityIndicator size="small" color="#111827" />
        </View>
        <Text style={styles.stateTitle}>ライブラリを整えています</Text>
        <Text style={styles.stateCopy}>作品棚を最新の状態にしています。</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.stateScreen}>
        <View style={[styles.stateIcon, styles.errorIcon]}>
          <Ionicons name="cloud-offline-outline" size={24} color="#b42318" />
        </View>
        <Text style={styles.stateTitle}>アニメ一覧を読み込めませんでした</Text>
        <Text style={styles.stateCopy}>
          通信状態を確認して、もう一度お試しください。
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="アニメ一覧を再取得"
        >
          <Ionicons name="refresh" size={17} color="#ffffff" />
          <Text style={styles.primaryButtonText}>再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        key={`anime-list-${numColumns}`}
        data={filtered}
        numColumns={numColumns}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.listContent,
          {
            alignItems: isWide ? "center" : "flex-start",
            paddingHorizontal: isWide ? 0 : 18,
            paddingTop: insets.top + (isWide ? 26 : 12),
            paddingBottom: insets.bottom + 28,
          },
        ]}
        columnWrapperStyle={
          numColumns > 1
            ? [styles.columnWrapper, { width: contentWidth }]
            : undefined
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={[styles.header, { width: contentWidth }]}>
            <View style={[styles.hero, isWide && styles.heroWide]}>
              <View style={styles.heroAccent} />
              <View style={[styles.heroTop, isWide && styles.heroTopWide]}>
                <View style={styles.heroCopy}>
                  <Text style={styles.eyebrow}>ANIMEISHI LIBRARY</Text>
                  <Text style={[styles.title, isWide && styles.titleWide]}>
                    アニメを探す
                  </Text>
                  <Text
                    style={[styles.subtitle, isWide && styles.subtitleWide]}
                  >
                    好きな作品をすばやく見つけて、名刺に残す。
                  </Text>
                </View>

                <View style={styles.heroControls}>
                  <View style={styles.searchBar}>
                    <Ionicons name="search" size={20} color="#64748b" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="タイトル・よみがな・英語名で検索"
                      placeholderTextColor="#94a3b8"
                      value={query}
                      onChangeText={setQuery}
                      testID="search-input"
                      accessibilityLabel="アニメ検索"
                    />
                    {query ? (
                      <TouchableOpacity
                        style={styles.clearButton}
                        onPress={() => setQuery("")}
                        accessibilityRole="button"
                        accessibilityLabel="検索語をクリア"
                      >
                        <Ionicons name="close" size={17} color="#475569" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.statsRow}>
                    <StatPill
                      label="作品"
                      value={`${stats.total}`}
                      tone="ink"
                    />
                    <StatPill
                      label="年代"
                      value={stats.yearRange}
                      tone="gold"
                    />
                    <StatPill
                      label="ジャンル"
                      value={`${stats.genreCount}`}
                      tone="mint"
                    />
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.toolbar, isWide && styles.toolbarWide]}>
              <View>
                <Text style={styles.sectionLabel}>コレクション</Text>
                <Text style={styles.resultText}>
                  {query.trim()
                    ? `「${query.trim()}」の検索結果・${filtered.length}件`
                    : `すべての作品・${filtered.length}件`}
                </Text>
              </View>
              <View style={[styles.sortGroup, isWide && styles.sortGroupWide]}>
                <SortButton
                  label="タイトル"
                  icon="text-outline"
                  active={sortKey === "title"}
                  order={sortKey === "title" ? sortOrder : null}
                  onPress={() => toggleSort("title")}
                />
                <SortButton
                  label="年度"
                  icon="calendar-clear-outline"
                  active={sortKey === "year"}
                  order={sortKey === "year" ? sortOrder : null}
                  onPress={() => toggleSort("year")}
                />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[styles.card, { width: cardWidth }]}
            testID={`anime-item-${item.id}`}
          >
            <AnimePoster uri={item.thumbnailUrl} title={item.title} />
            <View style={styles.cardBody}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <FavoriteButton
                  isFavorite={favoriteIds.has(item.id)}
                  disabled={isToggling}
                  onPress={() => toggleFavorite(item.id)}
                  title={item.title}
                />
              </View>
              {item.titleEnglish ? (
                <Text style={styles.englishTitle} numberOfLines={1}>
                  {item.titleEnglish}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                {item.year ? (
                  <View style={styles.seasonChip}>
                    <Ionicons
                      name="sparkles-outline"
                      size={12}
                      color="#92400e"
                    />
                    <Text style={styles.seasonText}>
                      {formatYearSeason(item.year, item.season)}
                    </Text>
                  </View>
                ) : null}
                {(item.genres ?? []).slice(0, 2).map((g: string) => (
                  <View key={g} style={styles.genreChip}>
                    <Text style={styles.genreText} numberOfLines={1}>
                      {g}
                    </Text>
                  </View>
                ))}
                {(item.genres ?? []).length > 2 ? (
                  <Text style={styles.moreGenres}>
                    +{(item.genres ?? []).length - 2}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.stateIcon}>
              <Ionicons name="search-outline" size={24} color="#475569" />
            </View>
            <Text style={styles.emptyTitle}>見つかりませんでした</Text>
            <Text style={styles.emptyCopy}>
              タイトル、よみがな、英語名を少し変えて探してみてください。
            </Text>
          </View>
        }
      />
    </View>
  );
}

function AnimePoster({
  uri,
  title,
}: {
  uri: string | null | undefined;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const palette = getPosterPalette(title);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={styles.poster}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityLabel={`${title}のサムネイル`}
      />
    );
  }

  return (
    <View
      style={[
        styles.posterPlaceholder,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View
        style={[
          styles.posterPlaceholderAccent,
          { backgroundColor: palette.accent },
        ]}
      />
      <Text style={[styles.posterInitial, { color: palette.text }]}>
        {getPosterInitial(title)}
      </Text>
      <Text style={[styles.posterFallbackLabel, { color: palette.text }]}>
        ANIME
      </Text>
    </View>
  );
}

function FavoriteButton({
  isFavorite,
  disabled,
  onPress,
  title,
}: {
  isFavorite: boolean;
  disabled: boolean;
  onPress: () => void;
  title: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.favoriteButton, isFavorite && styles.favoriteButtonActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite, disabled }}
      accessibilityLabel={
        isFavorite
          ? `${title}をお気に入りから解除`
          : `${title}をお気に入りに追加`
      }
    >
      <Ionicons
        name={isFavorite ? "heart" : "heart-outline"}
        size={21}
        color={isFavorite ? "#e11d48" : "#64748b"}
      />
    </TouchableOpacity>
  );
}

function SortButton({
  label,
  icon,
  active,
  order,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  order: SortOrder | null;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.sortButton, active && styles.sortButtonActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${order === "asc" ? " 昇順" : order === "desc" ? " 降順" : ""}`}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={14} color={active ? "#111827" : "#64748b"} />
      <Text style={[styles.sortText, active && styles.sortTextActive]}>
        {label}
      </Text>
      {order ? (
        <Ionicons
          name={order === "asc" ? "arrow-up" : "arrow-down"}
          size={13}
          color={active ? "#111827" : "#64748b"}
        />
      ) : null}
    </TouchableOpacity>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "gold" | "mint";
}) {
  return (
    <View style={[styles.statPill, styles[`statPill_${tone}`]]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function useAnimeStats(data: AnimeTitle[] | undefined) {
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

function formatYearSeason(year: number, season: string | null | undefined) {
  return `${year}年${season ? (SEASONS[season] ?? "") : ""}`;
}

function getPosterInitial(title: string) {
  return Array.from(title.trim())[0] ?? "A";
}

function getPosterPalette(title: string) {
  const index = Array.from(title).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  return POSTER_PALETTES[index % POSTER_PALETTES.length];
}

function getAnimeListLayout(width: number) {
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f3ee",
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
    gap: 16,
    marginBottom: 2,
  },
  hero: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#fffaf2",
    borderWidth: 1,
    borderColor: "#efe4d4",
    padding: 18,
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  heroWide: {
    padding: 28,
  },
  heroAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: "#eab308",
  },
  heroTop: {
    gap: 18,
  },
  heroTopWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 32,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroControls: {
    flex: 1,
    minWidth: 0,
    width: "100%",
  },
  eyebrow: {
    color: "#7c2d12",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
  },
  title: {
    marginTop: 5,
    color: "#111827",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: 0,
  },
  titleWide: {
    fontSize: 38,
    lineHeight: 44,
  },
  subtitle: {
    marginTop: 7,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  subtitleWide: {
    maxWidth: 520,
    fontSize: 15,
    lineHeight: 22,
  },
  searchBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 13,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: "#111827",
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
    backgroundColor: "#f1f5f9",
  },
  statsRow: {
    marginTop: 13,
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
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  statPill_gold: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  statPill_mint: {
    backgroundColor: "#ecfdf5",
    borderColor: "#bbf7d0",
  },
  statValue: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "900",
  },
  statLabel: {
    marginTop: 1,
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
  },
  toolbar: {
    gap: 10,
  },
  toolbarWide: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: "#7c2d12",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
  },
  resultText: {
    marginTop: 2,
    color: "#111827",
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
    borderColor: "#dbe4ee",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
  },
  sortButtonActive: {
    borderColor: "#111827",
    backgroundColor: "#ffffff",
  },
  sortText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
  },
  sortTextActive: {
    color: "#111827",
  },
  card: {
    flexDirection: "row",
    gap: 13,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 10,
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 2,
  },
  poster: {
    width: 68,
    height: 92,
    borderRadius: 6,
    backgroundColor: "#e2e8f0",
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
    color: "#111827",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0,
  },
  englishTitle: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
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
    backgroundColor: "#fef3c7",
    paddingHorizontal: 8,
  },
  seasonText: {
    color: "#92400e",
    fontSize: 11,
    fontWeight: "900",
  },
  genreChip: {
    maxWidth: 92,
    minHeight: 25,
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
  },
  genreText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "800",
  },
  moreGenres: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900",
  },
  favoriteButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  favoriteButtonActive: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3",
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
    backgroundColor: "#f6f3ee",
    paddingHorizontal: 32,
  },
  loadingMark: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  stateIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  errorIcon: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3",
  },
  stateTitle: {
    marginTop: 16,
    color: "#111827",
    textAlign: "center",
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "900",
  },
  stateCopy: {
    marginTop: 7,
    color: "#64748b",
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
    backgroundColor: "#111827",
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  emptyTitle: {
    marginTop: 14,
    color: "#111827",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyCopy: {
    marginTop: 7,
    color: "#64748b",
    textAlign: "center",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
});
