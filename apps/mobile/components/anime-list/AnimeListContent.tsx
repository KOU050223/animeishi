import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAnimeList,
  usePrefetchSeasonWorks,
  useSortedAnimeList,
} from "@/lib/useAnimeList";
import type { AnimeTitle, SortKey, SortOrder } from "@/lib/useAnimeList";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { Input } from "@/components/ui";
import { AnimeListSkeleton } from "./AnimeListSkeleton";
import { AnimePoster } from "./AnimePoster";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";
import type { WorkDetailSheetTarget } from "./AnimeWorkDetailSheet";
import { FavoriteButton } from "./FavoriteButton";
import { SeasonFilter } from "./SeasonFilter";
import { SortButton } from "./SortButton";
import { trackEvent } from "@/lib/events";
import { StatPill } from "./StatPill";
import { useAnimeListPalette, useAnimeListStyles } from "./animeListStyles";
import {
  adjacentSeasonParams,
  currentSeason,
  formatSeasonLabel,
  formatWorkSeason,
  getAnimeListLayout,
  toSeasonParam,
  useAnimeStats,
  type SeasonKey,
} from "./animeListUtils";

export function AnimeListContent({
  favoriteIds,
  toggleFavorite,
  isToggling,
  initialQuery,
}: {
  favoriteIds: Set<number>;
  toggleFavorite: (annictWorkId: number) => void;
  isToggling: boolean;
  // 検索遷移（library?q=）で検索語を入れた状態で開くための初期値。
  // 途中変更は key によるリマウントで反映する（呼び出し側が key を変える）。
  initialQuery?: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const styles = useAnimeListStyles();
  const palette = useAnimeListPalette();
  const { width } = useWindowDimensions();
  const { contentWidth, cardWidth, numColumns, isWide } =
    getAnimeListLayout(width);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  // シーズン絞り込みの選択状態（初期は JST の今年・今期。API の「今期」判定に揃える）。
  // 検索語が空のときだけ効く。
  const [filterYear, setFilterYear] = useState(() => currentSeason().year);
  const [filterSeason, setFilterSeason] = useState<SeasonKey>(
    () => currentSeason().key,
  );
  const seasonParam = toSeasonParam(filterYear, filterSeason);

  // 検索語があれば title 検索、無ければ選択中のシーズンで一覧を取得する（クライアント側に
  // 作品マスタは持たず Annict searchWorks をプロキシ経由で叩く）。
  const {
    data,
    isLoading,
    isError,
    isFetching,
    isPlaceholderData,
    refetch,
    isConnected,
    isConnectionLoading,
    isSeason,
  } = useAnimeList(query, seasonParam);
  const hasQuery = query.trim().length > 0;

  // 前後シーズンを先読みして切り替え直後の待ちを消す（issue #173）。
  // 表示中のクエリが走っている間は譲り、確定してから発火させる。
  // 検索語があるときはシーズン切り替え自体が起きないので無効化する。
  usePrefetchSeasonWorks(
    adjacentSeasonParams(filterYear, filterSeason),
    isSeason && !isFetching,
  );

  const [refreshing, setRefreshing] = useState(false);
  // カード押下で開く作品詳細シートの対象（issue #347）。
  const [selectedWork, setSelectedWork] = useState<AnimeTitle | null>(null);
  const sorted = useSortedAnimeList(data, sortKey, sortOrder);
  const stats = useAnimeStats(data);

  async function onRefresh() {
    // refetch は react-query の enabled を無視して手動実行されるため、未連携で
    // pull-to-refresh すると 401 で無駄な失敗になる。enabled と同じ条件（連携済み）で
    // のみ再取得する。検索語が空でも今期アニメを取りに行くので hasQuery は問わない。
    if (!isConnected) return;
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
  // 連携済みでフェッチ中のときだけローディング扱いにする（未連携時の pending を
  // 「連携前」と区別する）。検索語が空でも今期アニメを取得するためローディングを出す。
  // シーズン/検索キー切り替えでキャッシュ未ヒットの間（placeholderData が前回
  // 結果を差し込んでいる間）もローディング扱いにする。前シーズンの一覧を
  // 残したまま新しいラベルを出すと切り替えが効いたか分かりにくいため（issue #173）。
  const showLoading =
    isConnected && (isLoading || (isPlaceholderData && isFetching));

  // 表示できる作品があるのにバックグラウンド再取得の失敗でエラー画面へ
  // 置き換えない。tier 表側の画像補完ポーリングが同じクエリキーを再取得する
  // （キャッシュ共有）ため、その失敗もここに現れうる。作品が無い初回失敗だけ
  // 空配列にして ListEmptyComponent のエラー表示へ繋げる。
  const hideForError = isError && sorted.length === 0;

  // キャラクター tier 表への入口（issue #169）。対象作品をパラメータで渡し、
  // 画面側は作品のキャスト一覧を取得する。#347 でカード上のボタンから
  // 詳細シートのボタンに移した。
  const openCharacterTierList = useCallback(
    (work: WorkDetailSheetTarget) => {
      // キャラクター tier 表を開く操作を計測する（issue #214）。
      trackEvent("character_tier_open");
      router.push({
        pathname: "/character-tier-list",
        params: { workId: String(work.annictWorkId), workTitle: work.title },
      });
    },
    [router],
  );

  // renderItem を安定化して行ごとのコールバック生成を減らす。
  const renderItem = useCallback(
    ({ item }: { item: AnimeTitle }) => (
      <TouchableOpacity
        style={[styles.card, { width: cardWidth }]}
        testID={`anime-item-${item.annictWorkId}`}
        onPress={() => setSelectedWork(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}の詳細を開く`}
      >
        <AnimePoster uri={item.hostedImageUrl} title={item.title} />
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
          <View style={styles.metaRow}>
            {item.seasonYear ? (
              <View style={styles.seasonChip}>
                <Ionicons
                  name="sparkles-outline"
                  size={12}
                  color={palette.seasonChipText}
                />
                <Text style={styles.seasonText}>{formatWorkSeason(item)}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    ),
    [cardWidth, favoriteIds, isToggling, palette, styles, toggleFavorite],
  );

  return (
    <View style={styles.screen}>
      <FlatList
        key={`anime-list-${numColumns}`}
        data={showLoading || hideForError ? [] : sorted}
        numColumns={numColumns}
        keyExtractor={(item) => String(item.annictWorkId)}
        contentContainerStyle={[
          styles.listContent,
          {
            alignItems: isWide ? "center" : "flex-start",
            paddingHorizontal: isWide ? 0 : 18,
            // 上端の safe area はライブラリタブ側の SafeAreaView が取る（issue #170）。
            paddingTop: isWide ? 26 : 12,
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
            <View style={styles.searchBar}>
              <Ionicons name="search" size={20} color={palette.searchIcon} />
              <Input
                style={styles.searchInput}
                placeholder="タイトル・よみがな・英語名で検索"
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
                  <Ionicons name="close" size={17} color={palette.clearIcon} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.statsRow}>
              {/* ローディング中は data が前シーズン/前検索の結果を指すため
                  旧統計を出さない（読み込み中と件数が併記されるのを防ぐ）。 */}
              <StatPill
                label="作品"
                value={showLoading ? "-" : `${stats.total}`}
                tone="ink"
              />
              <StatPill
                label="年代"
                value={showLoading ? "-" : stats.yearRange}
                tone="gold"
              />
              <StatPill
                label="ジャンル"
                value={`${stats.genreCount}`}
                tone="mint"
              />
            </View>

            <View style={styles.toolbar}>
              <View style={styles.toolbarTop}>
                <View style={styles.toolbarCopy}>
                  <Text style={styles.sectionLabel}>
                    {hasQuery ? "コレクション" : "シーズンで探す"}
                  </Text>
                  <Text style={styles.resultText}>
                    {hasQuery
                      ? showLoading
                        ? `「${query.trim()}」を検索しています`
                        : `「${query.trim()}」の検索結果・${sorted.length}件`
                      : `${formatSeasonLabel(filterYear, filterSeason)}${showLoading ? "を読み込んでいます" : `・${sorted.length}件`}`}
                  </Text>
                </View>
                {/* シーズン Tier 表への入口（issue #169）。ヒーロー内の大きな
                    ボタンをやめ、ツールバー行のコンパクトなボタンにする（issue #170）。 */}
                <TouchableOpacity
                  className="items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950"
                  onPress={() => router.push("/tier-list")}
                  accessibilityRole="button"
                  accessibilityLabel="シーズンの Tier 表を作る"
                  testID="open-tier-list"
                >
                  <Text className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                    🏆 Tier 表
                  </Text>
                </TouchableOpacity>
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

            {/* シーズン絞り込みは title 検索時には効かないため、検索語が無いときだけ出す。 */}
            {!hasQuery ? (
              <SeasonFilter
                year={filterYear}
                season={filterSeason}
                onChange={(nextYear, nextSeason) => {
                  setFilterYear(nextYear);
                  setFilterSeason(nextSeason);
                }}
              />
            ) : null}
          </View>
        }
        renderItem={renderItem}
        ListEmptyComponent={
          isConnectionLoading ? (
            // 連携状態（SecureStore）の読み込み中は isConnected=false になるため、
            // 連携済みユーザーに一瞬ソフトゲートを見せて誤って OAuth を再開させないよう、
            // 確定するまではローディング表示にとどめる（watch-history と挙動を揃える）。
            <View style={styles.emptyState}>
              <View style={styles.loadingMark}>
                <ActivityIndicator size="small" color={palette.spinner} />
              </View>
              <Text style={styles.emptyTitle}>読み込んでいます</Text>
            </View>
          ) : !isConnected ? (
            // 検索は Annict 連携が前提（API 側で X-Annict-Token 必須）。未連携では
            // 検索結果ではなく連携誘導を最優先で出す。ソフトゲートからその場で連携できる。
            <AnnictSoftGate
              description="作品検索には Annict との連携が必要です。連携すると作品を探して名刺に残せます。"
              surface="anime_list"
              testID="anime-list-soft-gate"
            />
          ) : showLoading ? (
            // カード型スケルトンで即時フィードバックする（issue #173）。
            // シーズン切り替えの約 5 秒の間、スピナーだけだと操作が効いたか
            // 不安になるため、実カードと同じ配置のプレースホルダーを敷く。
            <AnimeListSkeleton
              cardWidth={cardWidth}
              contentWidth={contentWidth}
              numColumns={numColumns}
            />
          ) : isError ? (
            <View style={styles.emptyState}>
              <View style={[styles.stateIcon, styles.errorIcon]}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={24}
                  color={palette.errorIcon}
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
                <Ionicons
                  name="refresh"
                  size={17}
                  color={palette.primaryButtonText}
                />
                <Text style={styles.primaryButtonText}>再試行</Text>
              </TouchableOpacity>
            </View>
          ) : !hasQuery ? (
            // 検索語が空のときは選択シーズンの作品を取得しているが、結果が 0 件のケース。
            // 放送前で未登録のシーズンなどで起こりうる。別シーズンや検索を案内する。
            <View style={styles.emptyState}>
              <View style={styles.stateIcon}>
                <Ionicons
                  name="search-outline"
                  size={24}
                  color={palette.stateIcon}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {`${formatSeasonLabel(filterYear, filterSeason)}の作品が見つかりません`}
              </Text>
              <Text style={styles.emptyCopy}>
                別の年・シーズンを選ぶか、タイトルで検索してみてください。
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.stateIcon}>
                <Ionicons
                  name="search-outline"
                  size={24}
                  color={palette.stateIcon}
                />
              </View>
              <Text style={styles.emptyTitle}>見つかりませんでした</Text>
              <Text style={styles.emptyCopy}>
                タイトル、よみがな、英語名を少し変えて探してみてください。
              </Text>
            </View>
          )
        }
      />
      <AnimeWorkDetailSheet
        work={selectedWork}
        onClose={() => setSelectedWork(null)}
        isFavorite={
          selectedWork != null && favoriteIds.has(selectedWork.annictWorkId)
        }
        isTogglingFavorite={isToggling}
        onToggleFavorite={() => {
          if (selectedWork) toggleFavorite(selectedWork.annictWorkId);
        }}
        onOpenCharacterTierList={openCharacterTierList}
      />
    </View>
  );
}
