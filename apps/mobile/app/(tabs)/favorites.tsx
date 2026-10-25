import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import {
  useFavorites,
  useRemoveFavorite,
  matchesFavoriteQuery,
} from "@/lib/useFavorites";
import type { FavoriteItem } from "@/lib/useFavorites";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { Input } from "@/components/ui";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { useThemeColors } from "@/lib/theme";

export default function FavoritesScreen() {
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const { data: favorites, isLoading, isError, refetch } = useFavorites();
  const remove = useRemoveFavorite();

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return favorites ?? [];
    return (favorites ?? []).filter((f) => matchesFavoriteQuery(f, trimmed));
  }, [favorites, query]);

  const enriched = useMemo(
    () => filtered.map((f) => ({ favorite: f })),
    [filtered],
  );

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmRemove(annictWorkId: number) {
    confirm(
      "お気に入りを解除",
      "このアニメをお気に入りから外しますか？",
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
          .catch((e: unknown) =>
            alert(
              "お気に入りを解除できませんでした",
              e instanceof ApiRequestError
                ? e.message
                : "お気に入りの解除に失敗しました",
              { okLabel: "OK" },
            ),
          );
      },
      { confirmLabel: "解除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          お気に入りの取得に失敗しました
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="お気に入りを再取得"
        >
          <Text className="text-white font-semibold">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-900" edges={["top"]}>
      <View className="px-4 pt-3 pb-3">
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          お気に入り
        </Text>
        <Text className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
          {enriched.length} 件
        </Text>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="作品名で検索"
          className="mt-3 bg-gray-100 dark:bg-slate-800 rounded-lg px-3 py-2 text-gray-900 dark:text-slate-100"
          accessibilityLabel="お気に入りを検索"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={enriched}
        keyExtractor={(item) => String(item.favorite.annictWorkId)}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View
            style={styles.separator}
            className="bg-gray-100 dark:bg-slate-800"
          />
        )}
        renderItem={({ item }) => (
          <FavoriteRow
            favorite={item.favorite}
            onRemove={() => confirmRemove(item.favorite.annictWorkId)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 dark:text-slate-500 text-center">
              {query.trim()
                ? "該当するお気に入りが見つかりません。"
                : "お気に入りがありません。\nアニメ一覧から追加してください。"}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function FavoriteRow({
  favorite,
  onRemove,
}: {
  favorite: FavoriteItem;
  onRemove: () => void;
}) {
  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`favorite-item-${favorite.annictWorkId}`}
    >
      <WorkThumbnail uri={favorite.hostedImageUrl} />

      <View className="flex-1">
        <Text
          className="text-gray-900 dark:text-slate-100 font-medium"
          numberOfLines={2}
        >
          {favorite.title}
        </Text>
      </View>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 dark:bg-red-950 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={`${favorite.title} をお気に入りから解除`}
      >
        <Text className="text-xs text-red-500 dark:text-red-400">解除</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1 },
});
