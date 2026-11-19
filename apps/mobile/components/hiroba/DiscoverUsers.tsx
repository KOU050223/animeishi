import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui";
import { MeishiCard } from "@/components/MeishiCard";
import { buildProfileUrl } from "@/lib/profileUrl";
import { alert } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import {
  usePublicUsers,
  useToggleUserLike,
  type PublicUserItem,
  type PublicUsersSort,
} from "@/lib/usePublicUsers";
import { useReportUserFlow } from "@/lib/useReportUserFlow";
import type { ReportReason } from "@/lib/useModeration";
import { DiscoverReportSheet } from "./DiscoverReportSheet";

// ひろば「みつける」の名刺フィード（issue #418）。
// プロフィール公開設定（users.is_public）を立てたユーザーの名刺を
// 一覧し、「いいね順 / 新着順」の切り替え・いいね・通報ができる。
// 構造は作品リストフィード（DiscoverWorkLists, issue #422）と同じ。
export function DiscoverUsers() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { userId } = useAuth();
  const [sort, setSort] = useState<PublicUsersSort>("likes");
  const [refreshing, setRefreshing] = useState(false);
  const [reportTarget, setReportTarget] = useState<PublicUserItem | null>(null);

  const list = usePublicUsers(sort);
  const toggleLike = useToggleUserLike();
  const reportFlow = useReportUserFlow();

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  function onRefresh() {
    setRefreshing(true);
    void list.refetch().finally(() => setRefreshing(false));
  }

  function onEndReached() {
    if (list.hasNextPage && !list.isFetchingNextPage) {
      void list.fetchNextPage();
    }
  }

  function onPressLike(item: PublicUserItem) {
    toggleLike.mutate(
      { id: item.id, like: !item.likedByMe },
      {
        onError: () =>
          alert(
            t("いいねできませんでした"),
            t("時間をおいて再度お試しください。"),
            {
              okLabel: "OK",
            },
          ),
      },
    );
  }

  function onSelectReason(reason: ReportReason) {
    const target = reportTarget;
    setReportTarget(null);
    if (!target) return;
    reportFlow.submit({
      userId: target.id,
      username: target.username,
      reason,
    });
  }

  return (
    <View className="flex-1" testID="hiroba-discover-users">
      <SegmentedControl
        items={[
          {
            label: t("いいね順"),
            active: sort === "likes",
            onPress: () => setSort("likes"),
            testID: "hiroba-user-sort-likes",
          },
          {
            label: t("新着順"),
            active: sort === "new",
            onPress: () => setSort("new"),
            testID: "hiroba-user-sort-new",
          },
        ]}
      />
      {list.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : list.isError && items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-slate-500 dark:text-slate-400">
            公開名刺を取得できませんでした
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => void list.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("再読み込み")}
            testID="hiroba-user-retry"
          >
            <Text className="font-semibold text-white">{t("再読み込み")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          contentContainerClassName="gap-3 px-4 pb-8 pt-2"
          testID="hiroba-user-list"
          renderItem={({ item }) => (
            <PublicUserCard
              item={item}
              isOwn={item.id === userId}
              likePending={toggleLike.isPending}
              onPress={() =>
                router.push({
                  pathname: "/user/[uid]",
                  params: { uid: item.id },
                })
              }
              onPressLike={() => onPressLike(item)}
              onPressReport={() => setReportTarget(item)}
            />
          )}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-center text-slate-400 dark:text-slate-500">
                まだ公開されている名刺はありません
              </Text>
            </View>
          }
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : undefined
          }
        />
      )}

      <DiscoverReportSheet
        visible={reportTarget !== null}
        pending={reportFlow.isPending}
        title={t("このユーザーを通報")}
        testIdPrefix="discover-user-report"
        onSelect={onSelectReason}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

function PublicUserCard({
  item,
  isOwn,
  likePending,
  onPress,
  onPressLike,
  onPressReport,
}: {
  item: PublicUserItem;
  isOwn: boolean;
  likePending: boolean;
  onPress: () => void;
  onPressLike: () => void;
  onPressReport: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View
      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
      testID={`public-user-${item.id}`}
    >
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("「{{name}}」の名刺を開く", {
          name: item.username,
        })}
        testID={`public-user-open-${item.id}`}
      >
        <MeishiCard
          username={item.username}
          bio={item.bio}
          favoriteQuote={item.favoriteQuote}
          profileImageUrl={item.profileImageUrl}
          profileUrl={buildProfileUrl(item.id)}
          profileOnly
        />
      </TouchableOpacity>
      <View className="mt-2 flex-row items-center justify-between">
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-md px-1.5 py-1"
          onPress={onPressLike}
          // 自分の名刺にはいいね不可（API 側も 400 で弾く）。
          disabled={isOwn || likePending}
          accessibilityRole="button"
          accessibilityLabel={
            item.likedByMe
              ? `「${item.username}」の名刺へのいいねを取り消す`
              : `「${item.username}」の名刺にいいね`
          }
          accessibilityState={{ disabled: isOwn || likePending }}
          testID={`public-user-like-${item.id}`}
        >
          <Ionicons
            name={item.likedByMe ? "heart" : "heart-outline"}
            size={18}
            color={
              isOwn
                ? colors.textFaint
                : item.likedByMe
                  ? colors.danger
                  : colors.textMuted
            }
          />
          <Text
            className={`text-sm font-medium ${
              item.likedByMe
                ? "text-red-500 dark:text-red-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {item.likeCount}
          </Text>
        </TouchableOpacity>
        {!isOwn ? (
          <TouchableOpacity
            className="flex-row items-center gap-1 rounded-md px-1.5 py-1"
            onPress={onPressReport}
            accessibilityRole="button"
            accessibilityLabel={t("「{{name}}」を通報", {
              name: item.username,
            })}
            testID={`public-user-report-${item.id}`}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              {t("通報")}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
