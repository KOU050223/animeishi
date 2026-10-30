import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useActivityFeed } from "@/lib/useActivityFeed";
import type { ActivityFeedItem } from "@/lib/useActivityFeed";
import { activityText, formatRelativeTime } from "@/lib/activityText";
import { useThemeColors } from "@/lib/theme";

// フレンドの活動フィード（issue #265）。ホームの ScrollView 内に置く前提の
// セクションなので FlatList は使わず map で描画し、続きはボタンで読む。
export function ActivityFeedSection() {
  const colors = useThemeColors();
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

  return (
    <View className="mt-6" testID="activity-feed-section">
      <Text className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        フレンドの活動
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : isError ? (
        <View className="items-center rounded-xl bg-white dark:bg-slate-900 py-4">
          <Text className="text-slate-500 dark:text-slate-400">
            活動の取得に失敗しました
          </Text>
          <TouchableOpacity
            className="mt-2 rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2"
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="再読み込み"
          >
            <Text className="text-slate-700 dark:text-slate-200 font-semibold">
              再読み込み
            </Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View className="rounded-xl bg-white dark:bg-slate-900 px-4 py-4">
          <Text className="text-slate-500 dark:text-slate-400">
            まだフレンドの活動はありません
          </Text>
        </View>
      ) : (
        <View className="rounded-xl bg-white dark:bg-slate-900 px-4">
          {items.map((feedItem) => (
            <ActivityRow key={feedItem.id} item={feedItem} />
          ))}
          {hasNextPage && (
            <TouchableOpacity
              className="items-center py-3"
              onPress={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              accessibilityRole="button"
              accessibilityLabel="もっと見る"
              testID="activity-feed-load-more"
            >
              {isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
                  もっと見る
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityFeedItem }) {
  return (
    <View
      className="flex-row items-center gap-3 border-b border-slate-100 dark:border-slate-800 py-3 last:border-b-0"
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});
