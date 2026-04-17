import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import { useAnimeList, useFilteredAnimeList } from "@/lib/useAnimeList";
import type { SortKey, SortOrder } from "@/lib/useAnimeList";

const SEASONS: Record<string, string> = {
  spring: "春",
  summer: "夏",
  fall: "秋",
  winter: "冬",
};

export default function AnimeListScreen() {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const { data, isLoading, isError, refetch } = useAnimeList();
  const filtered = useFilteredAnimeList(data, query, sortKey, sortOrder);

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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-red-500 text-center mb-4">
          アニメ一覧の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
        >
          <Text className="text-white font-semibold">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* 検索バー */}
      <View className="px-4 pt-12 pb-2">
        <TextInput
          className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
          placeholder="タイトルで検索..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={setQuery}
          testID="search-input"
          accessibilityLabel="アニメ検索"
        />
      </View>

      {/* ソートボタン */}
      <View className="flex-row px-4 pb-2 gap-2">
        <SortButton
          label="タイトル順"
          active={sortKey === "title"}
          order={sortKey === "title" ? sortOrder : null}
          onPress={() => toggleSort("title")}
        />
        <SortButton
          label="年度順"
          active={sortKey === "year"}
          order={sortKey === "year" ? sortOrder : null}
          onPress={() => toggleSort("year")}
        />
      </View>

      <Text className="px-4 pb-1 text-xs text-gray-400">
        {filtered.length} 件
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 1 }} className="bg-gray-100" />}
        renderItem={({ item }) => (
          <View className="flex-row items-center py-3 gap-3" testID={`anime-item-${item.id}`}>
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={{ width: 48, height: 64, borderRadius: 4, backgroundColor: '#e5e7eb' }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: 48, height: 64, borderRadius: 4 }} className="bg-gray-200 items-center justify-center">
                <Text className="text-gray-400 text-xs">No img</Text>
              </View>
            )}
            <View className="flex-1">
              <Text className="text-gray-900 font-medium" numberOfLines={2}>
                {item.title}
              </Text>
              {item.titleEnglish ? (
                <Text className="text-gray-400 text-xs mt-0.5" numberOfLines={1}>
                  {item.titleEnglish}
                </Text>
              ) : null}
              <View className="flex-row gap-2 mt-1 flex-wrap">
                {item.year ? (
                  <Text className="text-indigo-500 text-xs">
                    {item.year}年
                    {item.season ? SEASONS[item.season] ?? "" : ""}
                  </Text>
                ) : null}
                {(item.genres ?? []).slice(0, 3).map((g) => (
                  <Text key={g} className="text-gray-500 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                    {g}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400">該当するアニメが見つかりません</Text>
          </View>
        }
      />
    </View>
  );
}

function SortButton({
  label,
  active,
  order,
  onPress,
}: {
  label: string;
  active: boolean;
  order: SortOrder | null;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className={`flex-row items-center px-3 py-1.5 rounded-full border ${
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white"
      }`}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text className={`text-xs font-medium ${active ? "text-indigo-600" : "text-gray-500"}`}>
        {label}
        {order === "asc" ? " ↑" : order === "desc" ? " ↓" : ""}
      </Text>
    </TouchableOpacity>
  );
}
