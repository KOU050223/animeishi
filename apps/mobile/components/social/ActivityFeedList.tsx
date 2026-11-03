import { useState } from "react";
import type { ComponentType, ReactElement } from "react";
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

export type ActivityFeedListProps = {
  /** リスト先頭に挿すコンテンツ。ホームではストーリーリング等を載せる。 */
  ListHeaderComponent?: ComponentType | ReactElement;
  /**
   * pull-to-refresh の処理を上書きする。省略時はフィードの refetch だけを
   * 行う。ホームのように他のクエリもまとめて更新したい画面が渡す。
   */
  onRefresh?: () => Promise<unknown> | void;
};

// フレンドの活動フィード（issue #265 の一覧本体）。読み込み・エラー・空は
// ListEmptyComponent に寄せてあり、ヘッダー付きで使う画面（ホーム。issue
// #353）でもロード中にヘッダーが消えない。
export function ActivityFeedList({
  ListHeaderComponent,
  onRefresh,
}: ActivityFeedListProps) {
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
  const items =
    isLoading || isError
      ? []
      : (data?.pages.flatMap((page) => page.items) ?? []);

  // try/finally（catch 無しの try）は React Compiler が未対応で最適化を
  // 外れるため、Promise.finally で書く
  function handleRefresh() {
    setRefreshing(true);
    const task = onRefresh ? onRefresh() : refetch();
    void Promise.resolve(task).finally(() => setRefreshing(false));
  }

  function onEndReached() {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <ActivityRow item={item} />}
      ListHeaderComponent={ListHeaderComponent}
      ItemSeparatorComponent={() => (
        <View
          style={styles.separator}
          className="bg-slate-100 dark:bg-slate-800"
        />
      )}
      contentContainerStyle={styles.listContent}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      testID="activity-feed-list"
      ListEmptyComponent=<FeedStatus
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      />
      ListFooterComponent={
        isFetchingNextPage ? (
          <View className="py-4">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : undefined
      }
    />
  );
}

function FeedStatus({
  isLoading,
  isError,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const colors = useThemeColors();
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="mb-4 text-center text-slate-500 dark:text-slate-400">
          活動の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="rounded-lg bg-indigo-600 px-6 py-3"
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="再読み込み"
        >
          <Text className="font-semibold text-white">再読み込み</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View className="items-center justify-center py-16">
      <Text className="text-center text-slate-400 dark:text-slate-500">
        まだフレンドの活動はありません
      </Text>
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
