import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import {
  useFavorites,
  useRemoveFavorite,
  matchesFavoriteQuery,
} from "@/lib/useFavorites";
import type { FavoriteItem } from "@/lib/useFavorites";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Input } from "@/components/ui";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { WorkDetailPressable } from "@/components/anime-list/WorkDetailPressable";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useThemeColors } from "@/lib/theme";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";
import {
  GRID_GAP,
  getRowListGridLayout,
} from "@/components/anime-list/animeListUtils";

// ライブラリタブの「推し」セクション（旧お気に入りタブ）。
// 画面上部の safe area とセクション切り替えはライブラリ画面側が持つため、
// ここではセクション名の見出しを出さず件数と検索欄だけを表示する。
export function FavoritesSection() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  // Web の広い幅では行一覧を複数列にする（issue #602）。Platform.OS ではなく
  // 幅だけで判定し、狭い幅では従来どおり 1 列の全幅リストにする。
  const { width } = useWindowDimensions();
  const grid = getRowListGridLayout(width);
  const isGrid = grid.numColumns > 1;

  const { data: favorites, isLoading, isError, refetch } = useFavorites();
  const remove = useRemoveFavorite();
  const insets = useSafeAreaInsets();

  const trimmed = query.trim();
  const filtered = !trimmed
    ? (favorites ?? [])
    : (favorites ?? []).filter((f) => matchesFavoriteQuery(f, trimmed));

  const enriched = filtered.map((f) => ({ favorite: f }));

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmRemove(annictWorkId: number) {
    confirm(
      t("推し登録を解除"),
      t("このアニメを推しから外しますか？"),
      () => {
        // お気に入り解除の操作を計測する（issue #214）。
        // 一覧画面のトグルは useToggleFavorite 側で送るため、ここは
        // 確認ダイアログ経由の解除専用。
        trackEvent("favorite_toggle", {
          [TRACK_EVENT_KEYS.action]: "remove",
        });
        // 解除失敗は画面に変化が残らないため、ダイアログで必ず伝える。
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う。
        // ApiRequestError はユーザー向け日本語メッセージを持つ。
        void remove
          .mutateAsync(annictWorkId)
          .catch(() =>
            alert(
              t("推しを解除できませんでした"),
              t("推しの解除に失敗しました"),
              { okLabel: "OK" },
            ),
          );
      },
      {
        confirmLabel: t("解除"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-white dark:bg-slate-900">
        <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />
      </View>
    );
  }

  if (isError && !favorites) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          {t("推しの取得に失敗しました")}
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("推しを再取得")}
        >
          <Text className="text-white font-semibold">{t("再試行")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      {/* グリッド時は行の並ぶコンテンツ幅に揃えてヘッダーを中央寄せする
          （px-4 の内側が contentWidth になるよう +32 している）。 */}
      <View
        className="px-4 pt-1 pb-3"
        style={
          isGrid
            ? { width: grid.contentWidth + 32, alignSelf: "center" }
            : undefined
        }
      >
        {/* 作品リスト（issue #349）への入口。#352 で恒久的な置き場所は
            ひろばタブに決まったが、既存導線は残す決定のためこのボタンも残す。 */}
        <TouchableOpacity
          className="mb-3 flex-row items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 dark:border-indigo-800 dark:bg-indigo-950"
          onPress={() => router.push("/work-lists")}
          accessibilityRole="button"
          accessibilityLabel={t("作品リストを開く")}
          testID="favorites-open-work-lists"
        >
          <View className="flex-row items-center gap-1.5">
            <Ionicons
              name="list-outline"
              size={16}
              color={colors.primaryText}
            />
            <Text className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              {t("作品リスト")}
            </Text>
          </View>
          <Text className="text-xs text-indigo-500 dark:text-indigo-400">
            {t("テーマ別のリストを作って共有")}
          </Text>
        </TouchableOpacity>
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("{{count}} 件", { count: enriched.length })}
        </Text>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t("作品名で検索")}
          className="mt-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100"
          accessibilityLabel={t("推しを検索")}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        // numColumns の途中変更は未対応なので、列数が変わるたびに再マウントする
        // （アニメ一覧と同じ対処）。
        key={`favorites-${grid.numColumns}`}
        data={enriched}
        numColumns={grid.numColumns}
        keyExtractor={(item) => String(item.favorite.annictWorkId)}
        // 下端はネイティブのタブバーに潜り込むため、最後の行がその下に
        // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 32 + insets.bottom },
          isGrid && { paddingHorizontal: 0, alignItems: "center" },
        ]}
        columnWrapperStyle={
          isGrid
            ? {
                width: grid.contentWidth,
                gap: GRID_GAP,
                justifyContent: "flex-start",
              }
            : undefined
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={
          isGrid
            ? undefined
            : () => (
                <View
                  style={styles.separator}
                  className="bg-slate-100 dark:bg-slate-800"
                />
              )
        }
        renderItem={({ item }) => (
          <View style={isGrid ? { width: grid.columnWidth } : undefined}>
            <FavoriteRow
              favorite={item.favorite}
              onRemove={() => confirmRemove(item.favorite.annictWorkId)}
            />
            {/* グリッドでは行間セパレータが列をまたいで引けないため、
                各セルの下辺に同じ色の線を引く。 */}
            {isGrid ? (
              <View
                style={styles.separator}
                className="bg-slate-100 dark:bg-slate-800"
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-slate-400 dark:text-slate-500 text-center">
              {query.trim()
                ? t("該当する推しが見つかりません。")
                : t("推しがありません。\nアニメ一覧から登録してください。")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function FavoriteRow({
  favorite,
  onRemove,
}: {
  favorite: FavoriteItem;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`favorite-item-${favorite.annictWorkId}`}
    >
      <WorkDetailPressable
        work={favorite}
        className="flex-1 flex-row items-center gap-3"
      >
        <WorkThumbnail uri={favorite.hostedImageUrl} title={favorite.title} />
        <View className="flex-1">
          <Text
            className="text-slate-900 dark:text-slate-100 font-medium"
            numberOfLines={2}
          >
            {favorite.title}
          </Text>
        </View>
      </WorkDetailPressable>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 dark:bg-red-950 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={t("{{title}}を推しから解除", {
          title: favorite.title,
        })}
      >
        <Text className="text-xs text-red-500 dark:text-red-400">
          {t("解除")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1 },
});
