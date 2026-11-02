import { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useActivityFeed } from "@/lib/useActivityFeed";
import type { ActivityFeedItem } from "@/lib/useActivityFeed";
import { activityText, formatRelativeTime } from "@/lib/activityText";
import { useThemeColors } from "@/lib/theme";

// 画面上部の safe area とセクション切り替えはタブ画面側が持つため、
// ここではセクション名の見出しを出さない。
export function ActivityFeedSection() {
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useActivityFeed();
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  function onRefresh() {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }

  function onEndReached() {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }

  return (
    <View
      className="flex-1 bg-white dark:bg-slate-900"
      testID="activity-feed-section"
    >
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-slate-500 dark:text-slate-400">
            活動の取得に失敗しました
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="再読み込み"
          >
            <Text className="font-semibold text-white">再読み込み</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ActivityRow item={item} />}
          ItemSeparatorComponent={() => (
            <View
              style={styles.separator}
              className="bg-slate-100 dark:bg-slate-800"
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          testID="activity-feed-list"
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-center text-slate-400 dark:text-slate-500">
                まだフレンドの活動はありません
              </Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : undefined
          }
        />
      )}
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityFeedItem }) {
  return (
    <View
      className="flex-row items-center gap-3 py-3"
      testID={`activity-item-${item.id}`}
    >
      {item.actor.profileImageUrl ? (
        <Image
          source={{ uri: item.actor.profileImageUrl }}
          style={styles.avatar}
          className="bg-slate-200 dark:bg-slate-700"
          resizeMode="cover"
        />
      ) : (
        <View
          style={styles.avatar}
          className="items-center justify-center bg-indigo-100 dark:bg-indigo-900"
        >
          <Text className="font-semibold text-indigo-500 dark:text-indigo-300">
            {item.actor.username.charAt(0)}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-sm text-slate-900 dark:text-slate-100">
          <Text className="font-semibold">{item.actor.username}</Text>
          {" が"}
          {activityText(item)}
        </Text>
        <Text className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          {formatRelativeTime(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  separator: { height: 1 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});
