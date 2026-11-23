import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { isAnnictTokenError, useAnnictConnection } from "@/lib/annict";
import type { CollageStateFilter } from "@/lib/meishi/types";
import { useAnimeList } from "@/lib/useAnimeList";
import { WATCH_STATUS_LABELS } from "@/lib/useWatchHistory";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { formatYearSeason } from "@/components/anime-list/animeListUtils";
import { Input } from "@/components/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import type { TFunction } from "i18next";
import { useThemeColors } from "@/lib/theme";

// ピッカー行として必要な最小フィールド。FavoriteItem / WatchHistoryItem /
// works.search の works 要素はすべてこの形を満たす。
export type AnimePickItem = {
  annictWorkId: number;
  /** 作品画像プロキシの URL。名刺にはこの URL をそのまま保存する。 */
  hostedImageUrl?: string | null;
  title: string;
  titleEn?: string | null;
  seasonName?: string | null;
  seasonYear?: number | null;
};

type WatchStateKey = Exclude<CollageStateFilter, "all">;
type LibraryKey = "favorites" | WatchStateKey;

const LIBRARY_KEYS: LibraryKey[] = [
  "favorites",
  "WATCHING",
  "WATCHED",
  "WANNA_WATCH",
  "ON_HOLD",
  "STOP_WATCHING",
];

function libraryLabel(key: LibraryKey, t: TFunction): string {
  return key === "favorites" ? t("推し") : t(WATCH_STATUS_LABELS[key]);
}

function seasonText(item: AnimePickItem, t: TFunction): string {
  // seasonName は "2026-spring" 形式。formatYearSeason は "spring" 部を期待する。
  const season = item.seasonName?.includes("-")
    ? item.seasonName.split("-")[1]
    : item.seasonName;
  return formatYearSeason(item.seasonYear, season, t);
}

/** ピッカーの 1 行（サムネイル + タイトル + シーズン）。画像 URL を解決できない作品は選択不可。 */
function AnimePickRow({
  item,
  onPick,
}: {
  item: AnimePickItem;
  onPick: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const uri = item.hostedImageUrl ?? null;
  const sub = seasonText(item, t);
  return (
    <Pressable
      onPress={() => uri && onPick(uri)}
      disabled={!uri}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        opacity: uri ? 1 : 0.4,
      }}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}}の画像を追加", { title: item.title })}
    >
      <WorkThumbnail uri={uri} title={item.title} width={44} height={58} />
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: 14, fontWeight: "600", color: colors.text }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {sub ? (
          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// FlatList の renderItem は再描画のたびに再生成されると行の再レンダーが走るため、
// useCallback で固定する。
function useRenderRow(
  onPick: (uri: string) => void,
): ListRenderItem<AnimePickItem> {
  return useCallback(
    ({ item }) => <AnimePickRow item={item} onPick={onPick} />,
    [onPick],
  );
}

/** 「マイリスト」タブ: お気に入り + 視聴ステータス別ライブラリから選ぶ。 */
function LibraryList({
  favorites,
  watchHistory,
  isConnected,
  isConnectionLoading,
  onPick,
}: {
  favorites: AnimePickItem[];
  watchHistory: (AnimePickItem & { state: string | null })[];
  isConnected: boolean;
  isConnectionLoading: boolean;
  onPick: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [listKey, setListKey] = useState<LibraryKey>("favorites");
  const renderItem = useRenderRow(onPick);

  const libraryItems =
    listKey === "favorites"
      ? favorites
      : watchHistory.filter((item) => item.state === listKey);

  // お気に入りは Annict 連携が無くても持てる（issue #561）。視聴ステータス別の
  // リストは視聴履歴（Annict 連携が前提）から作るため、未連携ならそこだけ連携誘導を出す。
  const needsAnnictLink = listKey !== "favorites" && !isConnected;
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginBottom: 8 }}
        contentContainerStyle={{ gap: 6 }}
      >
        {LIBRARY_KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setListKey(key)}
            accessibilityRole="button"
            accessibilityLabel={libraryLabel(key, t)}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor:
                listKey === key ? colors.primary : colors.surfaceMuted,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: listKey === key ? colors.onPrimary : colors.text,
              }}
            >
              {libraryLabel(key, t)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {isConnectionLoading && listKey !== "favorites" ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : needsAnnictLink ? (
        <AnnictSoftGate
          description="視聴履歴の作品画像を使うには Annict との連携が必要です。連携すると視聴ステータス別のリストから画像を選べます。"
          surface="meishi_image_library"
          testID="anime-image-picker-library-soft-gate"
        />
      ) : (
        <FlatList
          data={libraryItems}
          keyExtractor={(item) => `${listKey}-${item.annictWorkId}`}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 13,
                textAlign: "center",
                marginTop: 32,
              }}
            >
              {listKey === "favorites"
                ? t("推しに作品がありません")
                : t("このリストに作品がありません")}
            </Text>
          }
        />
      )}
    </>
  );
}

/** 「検索」タブ: Annict 作品検索の結果一覧。 */
function SearchList({
  query,
  onPick,
}: {
  query: string;
  onPick: (uri: string) => void;
}) {
  const colors = useThemeColors();
  const {
    data: works,
    isLoading,
    isError,
    error,
    refetch,
    canBrowseWorks,
    isAccessLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAnimeList(query);
  const { t } = useTranslation();
  const renderItem = useRenderRow(onPick);

  if (isAccessLoading) {
    return <ActivityIndicator style={{ marginTop: 32 }} />;
  }
  // 未連携でも共用トークンで検索できる（issue #561）。共用トークンが無い・失効した
  // （本人が連携すれば直る）ときだけ連携誘導を出す。
  if (!canBrowseWorks || (isError && isAnnictTokenError(error))) {
    return (
      <AnnictSoftGate
        description="アニメ画像の検索には Annict との連携が必要です。連携すると作品を探して名刺に画像を追加できます。"
        surface="meishi_image_search"
        testID="anime-image-picker-soft-gate"
      />
    );
  }
  if (isError) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          {t("検索に失敗しました")}
        </Text>
        <Pressable
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("再試行")}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>
            {t("再試行")}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={works ?? []}
      keyExtractor={(item) => String(item.annictWorkId)}
      renderItem={renderItem}
      keyboardShouldPersistTaps="handled"
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        isLoading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 13,
              textAlign: "center",
              marginTop: 32,
            }}
          >
            {query.trim()
              ? t("見つかりませんでした")
              : t("作品を読み込んでいます")}
          </Text>
        )
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator style={{ marginVertical: 12 }} />
        ) : undefined
      }
    />
  );
}

/**
 * 名刺の画像要素に入れるアニメ画像を選ぶシート（issue #96）。
 * 「検索」タブは Annict 作品検索（任意のアニメ）、「マイリスト」タブは
 * お気に入り + Annict 視聴ステータス別ライブラリ（任意のアニメリスト）から選ぶ。
 * 選択時に作品画像プロキシの URL（hostedImageUrl）を onPick で返す。
 */
export function AnimeImagePicker({
  visible,
  onClose,
  onPick,
  favorites = [],
  watchHistory = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (uri: string) => void;
  favorites?: AnimePickItem[];
  watchHistory?: (AnimePickItem & { state: string | null })[];
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<"search" | "library">("search");
  const [query, setQuery] = useState("");
  // 連携状態はマイリストの視聴履歴側のソフトゲート判定専用。作品検索自体は
  // SearchList 側で行う（ゲートの判定も SearchList 側）。
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: colors.scrim }}
        />
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            // Modal は全画面を覆うため下端はホームインジケータまで届く。
            // 固定 24 ではホームインジケータ領域に掛かるので inset を足す
            // （issue #462。タブバーではなくウィンドウの inset を使う）。
            paddingBottom: 24 + (initialWindowMetrics?.insets.bottom ?? 0),
            height: Math.min(Math.round(height * 0.75), 640),
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontSize: 16, fontWeight: "bold", color: colors.text }}
            >
              {t("アニメ画像を選ぶ")}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("閉じる")}
              style={{ padding: 6 }}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
            {(
              [
                { key: "search", label: t("検索") },
                { key: "library", label: t("マイリスト") },
              ] as const
            ).map((tabOption) => (
              <Pressable
                key={tabOption.key}
                onPress={() => setTab(tabOption.key)}
                accessibilityRole="button"
                accessibilityLabel={tabOption.label}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor:
                    tab === tabOption.key
                      ? colors.primary
                      : colors.surfaceMuted,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color:
                      tab === tabOption.key ? colors.onPrimary : colors.text,
                  }}
                >
                  {tabOption.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "search" ? (
            <>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder={t("タイトルで検索")}
                autoFocus
                testID="anime-image-search-input"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  fontSize: 14,
                  marginBottom: 8,
                  color: colors.text,
                }}
              />
              <SearchList query={query} onPick={onPick} />
            </>
          ) : (
            <LibraryList
              favorites={favorites}
              watchHistory={watchHistory}
              isConnected={isConnected}
              isConnectionLoading={isConnectionLoading}
              onPick={onPick}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
