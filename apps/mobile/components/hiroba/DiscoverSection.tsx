import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { SegmentedControl } from "@/components/ui";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { alert, confirm } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import {
  usePublicWorkLists,
  useToggleWorkListLike,
  useReportWorkList,
  type PublicWorkListItem,
  type PublicWorkListSort,
} from "@/lib/workList/useWorkLists";
import {
  REPORT_REASONS,
  useBlockUser,
  type ReportReason,
} from "@/lib/useModeration";

// ひろばタブの「みつける」セクション（issue #422）。
// is_public を立てた作品リストをフレンド以外も含めて一覧し、
// 「いいね順 / 新着順」の切り替え・いいね・通報ができる。
// カーソルページングで末尾スクロールのたびに続きを読む。
export function DiscoverSection() {
  const colors = useThemeColors();
  const { userId } = useAuth();
  const [sort, setSort] = useState<PublicWorkListSort>("likes");
  const [refreshing, setRefreshing] = useState(false);
  const [reportTarget, setReportTarget] = useState<PublicWorkListItem | null>(
    null,
  );

  const list = usePublicWorkLists(sort);
  const toggleLike = useToggleWorkListLike();
  const reportWorkList = useReportWorkList();
  const blockUser = useBlockUser();

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

  function onPressLike(item: PublicWorkListItem) {
    toggleLike.mutate(
      { id: item.id, like: !item.likedByMe },
      {
        onError: () =>
          alert("いいねできませんでした", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
      },
    );
  }

  function onSubmitReport(reason: ReportReason) {
    const target = reportTarget;
    if (!target) return;
    reportWorkList.mutate(
      { id: target.id, reason },
      {
        onSuccess: () => {
          setReportTarget(null);
          // ユーザー通報と同じく、続けて所有者のブロックを提案する
          // （issue #148 と同じ流れ）。
          if (target.owner.userId !== userId) {
            confirm(
              "通報を受け付けました",
              `ご報告ありがとうございます。運営が内容を確認します。\n\nあわせて「${target.owner.username}」をブロックしますか？`,
              () => {
                blockUser.mutate(target.owner.userId);
              },
              {
                confirmLabel: "ブロックする",
                cancelLabel: "しない",
                destructive: true,
              },
            );
          } else {
            alert(
              "通報を受け付けました",
              "ご報告ありがとうございます。運営が内容を確認します。",
              { okLabel: "OK" },
            );
          }
        },
        onError: (e) => {
          setReportTarget(null);
          alert(
            "通報できませんでした",
            e instanceof Error ? e.message : "通報に失敗しました",
            { okLabel: "OK" },
          );
        },
      },
    );
  }

  return (
    <View className="flex-1" testID="hiroba-discover-section">
      <SegmentedControl
        items={[
          {
            label: "いいね順",
            active: sort === "likes",
            onPress: () => setSort("likes"),
            testID: "hiroba-discover-sort-likes",
          },
          {
            label: "新着順",
            active: sort === "new",
            onPress: () => setSort("new"),
            testID: "hiroba-discover-sort-new",
          },
        ]}
      />
      {list.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : list.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-slate-500 dark:text-slate-400">
            公開作品リストを取得できませんでした
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => void list.refetch()}
            accessibilityRole="button"
            accessibilityLabel="再読み込み"
            testID="hiroba-discover-retry"
          >
            <Text className="font-semibold text-white">再読み込み</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          contentContainerClassName="gap-3 px-4 pb-8 pt-2"
          testID="hiroba-discover-list"
          renderItem={({ item }) => (
            <PublicWorkListCard
              item={item}
              isOwn={item.owner.userId === userId}
              likePending={toggleLike.isPending}
              onPressLike={() => onPressLike(item)}
              onPressReport={() => setReportTarget(item)}
            />
          )}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-center text-slate-400 dark:text-slate-500">
                まだ公開されている作品リストはありません
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

      <BottomSheet
        visible={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        scrimAccessibilityLabel="通報をやめる"
      >
        <View className="px-4 pb-8 pt-4">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
            この作品リストを通報
          </Text>
          <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            理由を選択してください。運営が内容を確認します。
          </Text>
          <View className="mt-4 gap-2">
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-3"
                onPress={() => onSubmitReport(reason)}
                disabled={reportWorkList.isPending}
                accessibilityRole="button"
                accessibilityLabel={`${reason}で通報`}
                testID={`work-list-report-reason-${reason}`}
              >
                <Text className="text-slate-900 dark:text-slate-100">
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            className="mt-4 items-center py-2"
            onPress={() => setReportTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="キャンセル"
          >
            <Text className="text-slate-500 dark:text-slate-400">
              キャンセル
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
}

function PublicWorkListCard({
  item,
  isOwn,
  likePending,
  onPressLike,
  onPressReport,
}: {
  item: PublicWorkListItem;
  isOwn: boolean;
  likePending: boolean;
  onPressLike: () => void;
  onPressReport: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
      testID={`public-work-list-${item.id}`}
    >
      {item.thumbnails.length > 0 ? (
        <View className="mb-2 flex-row gap-1.5">
          {item.thumbnails.map((thumb) => (
            <WorkThumbnail
              key={thumb.annictWorkId}
              uri={thumb.hostedImageUrl}
              width={40}
              height={56}
            />
          ))}
        </View>
      ) : null}
      <Text
        className="text-sm font-medium text-slate-900 dark:text-slate-100"
        numberOfLines={2}
      >
        {item.title}
      </Text>
      <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {item.owner.username} ・ {item.itemCount} 作品
      </Text>
      <View className="mt-2 flex-row items-center justify-between">
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-md px-1.5 py-1"
          onPress={onPressLike}
          // 自分のリストにはいいね不可（API 側も 400 で弾く）。
          disabled={isOwn || likePending}
          accessibilityRole="button"
          accessibilityLabel={
            item.likedByMe
              ? `「${item.title}」のいいねを取り消す`
              : `「${item.title}」にいいね`
          }
          accessibilityState={{ disabled: isOwn || likePending }}
          testID={`work-list-like-${item.id}`}
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
            accessibilityLabel={`「${item.title}」を通報`}
            testID={`work-list-report-${item.id}`}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              通報
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
