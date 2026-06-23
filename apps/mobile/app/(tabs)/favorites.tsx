import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useFavorites, useRemoveFavorite } from "@/lib/useFavorites";
import { useAnimeList } from "@/lib/useAnimeList";
import type { FavoriteItem } from "@/lib/useFavorites";
import type { AnimeTitle } from "@/lib/useAnimeList";

export default function FavoritesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: favorites,
    isLoading: isFavoritesLoading,
    isError: isFavoritesError,
    refetch,
  } = useFavorites();
  const {
    data: animes,
    isLoading: isAnimeLoading,
    isError: isAnimeError,
    refetch: refetchAnimes,
  } = useAnimeList();
  const remove = useRemoveFavorite();

  const isLoading = isFavoritesLoading || isAnimeLoading;
  const isError = isFavoritesError || isAnimeError;

  // 失敗したクエリの両方を再取得する（片方だけ失敗した場合も復帰できるように）
  async function retry() {
    await Promise.all([refetch(), refetchAnimes()]);
  }

  const animeMap = new Map<number, AnimeTitle>(
    (animes ?? []).map((a) => [a.id, a]),
  );

  const enriched = (favorites ?? []).map((f) => ({
    favorite: f,
    anime: animeMap.get(f.animeId),
  }));

  async function onRefresh() {
    setRefreshing(true);
    await retry();
    setRefreshing(false);
  }

  function confirmRemove(animeId: number, title: string) {
    const message = `「${title}」をお気に入りから外しますか？`;

    // React Native の Alert.alert は Web では複数ボタンの onPress が
    // 発火しないため、Web では window.confirm にフォールバックする。
    if (Platform.OS === "web") {
      if (window.confirm(message)) {
        remove.mutate(animeId);
      }
      return;
    }

    Alert.alert("お気に入りを解除", message, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "解除",
        style: "destructive",
        onPress: () => remove.mutate(animeId),
      },
    ]);
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
          onPress={() => retry()}
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
        keyExtractor={(item) => String(item.favorite.animeId)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1 }} className="bg-gray-100" />
        )}
        renderItem={({ item }) => (
          <FavoriteRow
            favorite={item.favorite}
            anime={item.anime}
            onRemove={() =>
              confirmRemove(
                item.favorite.animeId,
                item.anime?.title ?? "（タイトル不明）",
              )
            }
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
  anime,
  onRemove,
}: {
  favorite: FavoriteItem;
  anime: AnimeTitle | undefined;
  onRemove: () => void;
}) {
  const title = anime?.title ?? "（タイトル不明）";

  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`favorite-item-${favorite.animeId}`}
    >
      {anime?.thumbnailUrl ? (
        <Image
          source={{ uri: anime.thumbnailUrl }}
          style={{
            width: 48,
            height: 64,
            borderRadius: 4,
            backgroundColor: "#e5e7eb",
          }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 48, height: 64, borderRadius: 4 }}
          className="bg-gray-200 items-center justify-center"
        >
          <Text className="text-gray-400 text-xs">No img</Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={2}>
          {title}
        </Text>
        {anime?.year ? (
          <Text className="text-xs text-gray-400 mt-0.5">{anime.year}</Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={`${title}をお気に入りから解除`}
      >
        <Text className="text-xs text-red-500">解除</Text>
      </TouchableOpacity>
    </View>
  );
}
