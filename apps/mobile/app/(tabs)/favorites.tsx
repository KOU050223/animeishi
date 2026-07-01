import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useFavorites, useRemoveFavorite } from "@/lib/useFavorites";
import type { FavoriteItem } from "@/lib/useFavorites";
import { confirm } from "@/lib/dialog";

export default function FavoritesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data: favorites, isLoading, isError, refetch } = useFavorites();
  const remove = useRemoveFavorite();

  const enriched = useMemo(
    () => (favorites ?? []).map((f) => ({ favorite: f })),
    [favorites],
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
      () => remove.mutate(annictWorkId),
      { confirmLabel: "解除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-red-500 text-center mb-4">
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
    <View className="flex-1 bg-white">
      <View className="px-4 pt-12 pb-3">
        <Text className="text-xl font-bold text-gray-900">お気に入り</Text>
        <Text className="text-xs text-gray-400 mt-0.5">
          {enriched.length} 件
        </Text>
      </View>

      <FlatList
        data={enriched}
        keyExtractor={(item) => String(item.favorite.annictWorkId)}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View style={styles.separator} className="bg-gray-100" />
        )}
        renderItem={({ item }) => (
          <FavoriteRow
            favorite={item.favorite}
            onRemove={() => confirmRemove(item.favorite.annictWorkId)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 text-center">
              お気に入りがありません。{"\n"}アニメ一覧から追加してください。
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
  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`favorite-item-${favorite.annictWorkId}`}
    >
      <View
        style={styles.thumbnailPlaceholder}
        className="bg-gray-200 items-center justify-center"
      >
        <Text className="text-gray-400 text-xs">No img</Text>
      </View>

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={2}>
          {favorite.title}
        </Text>
      </View>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={`${favorite.title} をお気に入りから解除`}
      >
        <Text className="text-xs text-red-500">解除</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1 },
  thumbnailPlaceholder: { width: 48, height: 64, borderRadius: 4 },
});
