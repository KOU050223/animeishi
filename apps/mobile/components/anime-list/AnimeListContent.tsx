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
import { useAnimeList, useSortedAnimeList } from "@/lib/useAnimeList";
import type { SortKey, SortOrder } from "@/lib/useAnimeList";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
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
  favoriteIds,
  toggleFavorite,
  isToggling,
}: {
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

  // 検索語のたびに Annict searchWorks をプロキシ経由で叩く（クライアント側に
  // 作品マスタは持たない）。検索語が空のうちはクエリは無効化される。
  const { data, isLoading, isError, refetch, isConnected, isConnectionLoading } =
    useAnimeList(query);
  const hasQuery = query.trim().length > 0;

  const [refreshing, setRefreshing] = useState(false);
  const sorted = useSortedAnimeList(data, sortKey, sortOrder);
  const stats = useAnimeStats(data);

  async function onRefresh() {
    // refetch は react-query の enabled を無視して手動実行されるため、未入力のまま
    // または未連携で pull-to-refresh すると title="" / 401 で無駄な失敗になる。
    // enabled と同じ条件（検索語あり + 連携済み）でのみ再取得する。
    if (!hasQuery || !isConnected) return;
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

  // 検索バーは ListHeaderComponent 内にあるため、状態ごとに早期 return すると
  // 入力欄ごと消えてしまう。未連携/ローディング/エラー/未入力は ListEmptyComponent 側で
  // 表現し、検索バーは常に画面に残す。
  // 連携済みかつ検索語が入っていてフェッチ中のときだけローディング扱いにする
  // （未連携・クエリ無効時の pending を「連携前/検索前」と区別する）。
  const showLoading = isConnected && hasQuery && isLoading;

  return (
    <View style={styles.screen}>
      <FlatList
        key={`anime-list-${numColumns}`}
        data={showLoading || isError ? [] : sorted}
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
                  {hasQuery
                    ? `「${query.trim()}」の検索結果・${sorted.length}件`
                    : "タイトルを入力して作品を探す"}
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
                        item.seasonName?.includes("-")
                          ? item.seasonName.split("-")[1]
                          : item.seasonName,
                      )}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          isConnectionLoading ? (
            // 連携状態（SecureStore）の読み込み中は isConnected=false になるため、
            // 連携済みユーザーに一瞬ソフトゲートを見せて誤って OAuth を再開させないよう、
            // 確定するまではローディング表示にとどめる（watch-history と挙動を揃える）。
            <View style={styles.emptyState}>
              <View style={styles.loadingMark}>
                <ActivityIndicator size="small" color="#111827" />
              </View>
              <Text style={styles.emptyTitle}>読み込んでいます</Text>
            </View>
          ) : !isConnected ? (
            // 検索は Annict 連携が前提（API 側で X-Annict-Token 必須）。未連携では
            // 検索結果ではなく連携誘導を最優先で出す。ソフトゲートからその場で連携できる。
            <AnnictSoftGate
              description="annict.softGate.works"
              testID="anime-list-soft-gate"
            />
          ) : showLoading ? (
            <View style={styles.emptyState}>
              <View style={styles.loadingMark}>
                <ActivityIndicator size="small" color="#111827" />
              </View>
              <Text style={styles.emptyTitle}>検索しています</Text>
              <Text style={styles.emptyCopy}>
                Annict から作品を探しています。
              </Text>
            </View>
          ) : isError ? (
            <View style={styles.emptyState}>
              <View style={[styles.stateIcon, styles.errorIcon]}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={24}
                  color="#b42318"
                />
              </View>
              <Text style={styles.emptyTitle}>検索に失敗しました</Text>
              <Text style={styles.emptyCopy}>
                通信状態を確認して、もう一度お試しください。
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => refetch()}
                accessibilityRole="button"
                accessibilityLabel="作品検索を再試行"
              >
                <Ionicons name="refresh" size={17} color="#ffffff" />
                <Text style={styles.primaryButtonText}>再試行</Text>
              </TouchableOpacity>
            </View>
          ) : !hasQuery ? (
            <View style={styles.emptyState}>
              <View style={styles.stateIcon}>
                <Ionicons name="search-outline" size={24} color="#475569" />
              </View>
              <Text style={styles.emptyTitle}>作品を検索しましょう</Text>
              <Text style={styles.emptyCopy}>
                タイトル・よみがな・英語名で検索すると作品が表示されます。
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.stateIcon}>
                <Ionicons name="search-outline" size={24} color="#475569" />
              </View>
              <Text style={styles.emptyTitle}>見つかりませんでした</Text>
              <Text style={styles.emptyCopy}>
                タイトル、よみがな、英語名を少し変えて探してみてください。
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}
