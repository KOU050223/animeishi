import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFilteredAnimeList } from "@/lib/useAnimeList";
import type { AnimeTitle, SortKey, SortOrder } from "@/lib/useAnimeList";
import { AnimePoster } from "./AnimePoster";
import { FavoriteButton } from "./FavoriteButton";
import { SortButton } from "./SortButton";
import { StatPill } from "./StatPill";
import { styles } from "./animeListStyles";
import {
  formatYearSeason,
  getAnimeListLayout,
  useAnimeStats,
} from "./animeListUtils";

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
  toggleFavorite: (annictWorkId: number) => void;
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
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
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
        keyExtractor={(item) => String(item.annictWorkId)}
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
            testID={`anime-item-${item.annictWorkId}`}
          >
            <AnimePoster uri={item.imageUrl} title={item.title} />
            <View style={styles.cardBody}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <FavoriteButton
                  isFavorite={favoriteIds.has(item.annictWorkId)}
                  disabled={isToggling}
                  onPress={() => toggleFavorite(item.annictWorkId)}
                  title={item.title}
                />
              </View>
              {item.titleEn ? (
                <Text style={styles.englishTitle} numberOfLines={1}>
                  {item.titleEn}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                {item.seasonYear ? (
                  <View style={styles.seasonChip}>
                    <Ionicons
                      name="sparkles-outline"
                      size={12}
                      color="#92400e"
                    />
                    <Text style={styles.seasonText}>
                      {formatYearSeason(
                        item.seasonYear,
                        item.seasonName?.split("-")[1],
                      )}
                    </Text>
                  </View>
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
