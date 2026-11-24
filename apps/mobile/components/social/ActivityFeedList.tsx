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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActivityFeed } from "@/lib/useActivityFeed";
import { useFriends } from "@/lib/useFriends";
import { useTranslation } from "react-i18next";
import type { ActivityFeedItem } from "@/lib/useActivityFeed";
import {
  activityText,
  activityGroupText,
  formatRelativeTime,
} from "@/lib/activityText";
import { groupActivityItems } from "@/lib/groupActivityItems";
import { useThemeColors } from "@/lib/theme";
import { WorkDetailPressable } from "@/components/anime-list/WorkDetailPressable";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";

export type ActivityFeedListProps = {
  /** リスト先頭に挿すコンテンツ。ホームではストーリーリング等を載せる。 */
  ListHeaderComponent?: ComponentType | ReactElement;
  /**
   * フィード末尾に挿すコンテンツ。次ページ読み込み中のスピナーと
   * 「すべて見る」より後ろに描画される。
   */
  ListFooterComponent?: ComponentType | ReactElement;
  /**
   * pull-to-refresh の処理を上書きする。省略時はフィードの refetch だけを
   * 行う。ホームのように他のクエリもまとめて更新したい画面が渡す。
   */
  onRefresh?: () => Promise<unknown> | void;
  /**
   * 表示する件数の上限。指定すると無限スクロールをやめ、上限を超える
   * 活動があるときは onShowAll への導線を出す。ホームはヘッダーとフッターの
   * レールに挟まれており、フィードが伸びるとフッターまで届かなくなるため使う。
   */
  maxItems?: number;
  /** maxItems で切った残りを見るための遷移。maxItems と組で渡す。 */
  onShowAll?: () => void;
};

// フレンドの活動フィード（issue #265 の一覧本体）。読み込み・エラー・空は
// ListEmptyComponent に寄せてあり、ヘッダー付きで使う画面（ホーム。issue
// #353）でもロード中にヘッダーが消えない。
export function ActivityFeedList({
  ListHeaderComponent,
  ListFooterComponent,
  onRefresh,
  maxItems,
  onShowAll,
}: ActivityFeedListProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
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
  const allItems =
    isLoading || (isError && !data)
      ? []
      : (data?.pages.flatMap((page) => page.items) ?? []);
  // maxItems はまとめ後の行数に掛ける（1 まとめ = 1 行）。
  const entries = groupActivityItems(allItems);
  const isLimited = maxItems !== undefined;
  const rows = isLimited ? entries.slice(0, maxItems) : entries;
  const hasMore = isLimited && (entries.length > maxItems || !!hasNextPage);

  // try/finally（catch 無しの try）は React Compiler が未対応で最適化を
  // 外れるため、Promise.finally で書く
  function handleRefresh() {
    setRefreshing(true);
    const task = onRefresh ? onRefresh() : refetch();
    void Promise.resolve(task).finally(() => setRefreshing(false));
  }

  function onEndReached() {
    if (!isLimited && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(entry) => entry.key}
      renderItem={({ item: entry }) =>
        entry.kind === "group" ? (
          <ActivityGroupRow items={entry.items} />
        ) : (
          <ActivityRow item={entry.item} />
        )
      }
      ListHeaderComponent={ListHeaderComponent}
      ItemSeparatorComponent={() => (
        <View
          style={styles.separator}
          className="bg-slate-100 dark:bg-slate-800"
        />
      )}
      // 下端はネイティブのタブバーに潜り込むため、最後の行がその下に
      // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        styles.listContent,
        { paddingBottom: 32 + insets.bottom },
      ]}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      testID="activity-feed-list"
      ListEmptyComponent=<FeedStatus
        isLoading={isLoading}
        isError={isError && !data}
        onRetry={() => void refetch()}
      />
      ListFooterComponent={
        <>
          {isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator color={colors.primaryText} />
            </View>
          ) : null}
          {hasMore && onShowAll ? (
            <TouchableOpacity
              className="items-center py-3"
              onPress={onShowAll}
              accessibilityRole="button"
              accessibilityLabel={t("フレンドの動きをすべて見る")}
              testID="activity-feed-show-all"
            >
              <Text className="text-sm font-semibold text-primary-text">
                {t("すべて見る")}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* ComponentType と ReactElement の両方を受ける
              （FlatList の同名 prop と同じ型） */}
          {typeof ListFooterComponent === "function" ? (
            <ListFooterComponent />
          ) : (
            ListFooterComponent
          )}
        </>
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
  const { t } = useTranslation();
  if (isLoading) {
    return <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />;
  }
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="mb-4 text-center text-muted">
          {t("活動の取得に失敗しました")}
        </Text>
        <TouchableOpacity
          className="rounded-lg bg-indigo-600 px-6 py-3"
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("再読み込み")}
        >
          <Text className="font-semibold text-white">{t("再読み込み")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <FeedEmptyState />;
}

// フレンド数は別クエリなので、0 人と確定するまでは導線を出さず従来の
// 空メッセージのままにする（issue #533）。
function FeedEmptyState() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: friends, isLoading: friendsLoading } = useFriends();

  if (friendsLoading) {
    return <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />;
  }

  if (!friends || friends.length > 0) {
    return (
      <View className="items-center justify-center py-16">
        <Text className="text-center text-muted">
          {t("まだフレンドの活動はありません")}
        </Text>
      </View>
    );
  }

  return (
    <View className="items-center justify-center px-8 py-16">
      <Text className="text-center text-muted">
        {t("まだフレンドがいません")}
      </Text>
      <Text className="mt-1 text-center text-sm text-muted">
        {t("フレンドを見つけると、ここに活動が表示されます")}
      </Text>
      <View className="mt-6 gap-3 self-stretch">
        <TouchableOpacity
          className="items-center rounded-lg bg-indigo-600 px-6 py-3"
          onPress={() => router.push("/(tabs)/social?section=qr")}
          accessibilityRole="button"
          accessibilityLabel={t("QR で名刺交換")}
          testID="activity-feed-find-friends-qr"
        >
          <Text className="font-semibold text-white">{t("QR で名刺交換")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="items-center rounded-lg border border-indigo-200 bg-indigo-50 px-6 py-3 dark:border-indigo-800 dark:bg-indigo-950"
          onPress={() =>
            router.push("/(tabs)/hiroba?section=discover&target=users")
          }
          accessibilityRole="button"
          accessibilityLabel={t("ひろばで名刺を探す")}
          testID="activity-feed-find-friends-hiroba"
        >
          <Text className="font-semibold text-primary-text">
            {t("ひろばで名刺を探す")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// 複数作品をまとめた行なので、どれか 1 作品への詳細リンクは付けない
// （issue #533）。
function ActivityGroupRow({ items }: { items: ActivityFeedItem[] }) {
  const { t } = useTranslation();
  const first = items[0];
  // groupActivityItems は 3 件以上のまとまりだけを group にするため空にはならない。
  if (!first) return null;
  return (
    <View
      className="flex-row items-center gap-3 py-3"
      testID={`activity-group-${first.id}`}
    >
      <ActivityAvatar actor={first.actor} />
      <View className="flex-1">
        <Text className="text-sm text-foreground">
          {activityGroupText(items, t)}
        </Text>
        <Text className="mt-0.5 text-xs text-muted">
          {formatRelativeTime(first.createdAt, t)}
        </Text>
      </View>
    </View>
  );
}

function ActivityAvatar({ actor }: { actor: ActivityFeedItem["actor"] }) {
  return actor.profileImageUrl ? (
    <Image
      source={{ uri: actor.profileImageUrl }}
      style={styles.avatar}
      className="bg-slate-200 dark:bg-slate-700"
      resizeMode="cover"
    />
  ) : (
    <View
      style={styles.avatar}
      className="items-center justify-center bg-indigo-100 dark:bg-indigo-900"
    >
      <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
        {actor.username.charAt(0)}
      </Text>
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityFeedItem }) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center gap-3 py-3"
      testID={`activity-item-${item.id}`}
    >
      <ActivityAvatar actor={item.actor} />

      {item.work ? (
        <WorkDetailPressable work={item.work} className="flex-1">
          <Text className="text-sm text-foreground">
            {activityText(item, t)}
          </Text>
          <Text className="mt-0.5 text-xs text-muted">
            {formatRelativeTime(item.createdAt, t)}
          </Text>
        </WorkDetailPressable>
      ) : (
        <View className="flex-1">
          <Text className="text-sm text-foreground">
            {activityText(item, t)}
          </Text>
          <Text className="mt-0.5 text-xs text-muted">
            {formatRelativeTime(item.createdAt, t)}
          </Text>
        </View>
      )}
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
