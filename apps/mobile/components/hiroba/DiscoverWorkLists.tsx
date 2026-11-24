import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui";
import { WorkThumbnail } from "@/components/anime-list/WorkThumbnail";
import { WorkDetailPressable } from "@/components/anime-list/WorkDetailPressable";
import { CardPressable } from "@/components/ui/card-pressable";
import { WorkListReportSheet } from "@/components/work-list/WorkListReportSheet";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";
import { useThemeColors } from "@/lib/theme";
import {
  usePublicWorkLists,
  useToggleWorkListLike,
  type PublicWorkListItem,
  type PublicWorkListSort,
} from "@/lib/workList/useWorkLists";
import { useReportWorkListFlow } from "@/lib/workList/useReportWorkListFlow";
import type { ReportReason } from "@/lib/useModeration";

// ひろば「みつける」の作品リストフィード（issue #422）。
// is_public を立てた作品リストをフレンド以外も含めて一覧し、
// 「いいね順 / 新着順」の切り替え・いいね・通報ができる。
// カーソルページングで末尾スクロールのたびに続きを読む。
export function DiscoverWorkLists() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const [sort, setSort] = useState<PublicWorkListSort>("likes");
  const [refreshing, setRefreshing] = useState(false);
  const [reportTarget, setReportTarget] = useState<PublicWorkListItem | null>(
    null,
  );

  const list = usePublicWorkLists(sort);
  const toggleLike = useToggleWorkListLike();
  const reportFlow = useReportWorkListFlow();

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
        onError: (e) =>
          alert(
            t("いいねできませんでした"),
            e instanceof ApiRequestError
              ? t(e.message, { defaultValue: e.message })
              : t("いいねの更新に失敗しました"),
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
      id: target.id,
      ownerUserId: target.owner.userId,
      ownerUsername: target.owner.username,
      reason,
    });
  }

  return (
    <View className="flex-1" testID="hiroba-discover-work-lists">
      <SegmentedControl
        items={[
          {
            label: t("いいね順"),
            active: sort === "likes",
            onPress: () => setSort("likes"),
            testID: "hiroba-discover-sort-likes",
          },
          {
            label: t("新着順"),
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
      ) : list.isError && items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-muted">
            {t("公開作品リストを取得できませんでした")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => void list.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("再読み込み")}
            testID="hiroba-discover-retry"
          >
            <Text className="font-semibold text-white">{t("再読み込み")}</Text>
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
          // 下端はネイティブのタブバーに潜り込むため、最後の行がその下に
          // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{
            gap: 12,
            paddingHorizontal: 16,
            paddingBottom: 32 + insets.bottom,
            paddingTop: 8,
          }}
          testID="hiroba-discover-list"
          renderItem={({ item }) => (
            <PublicWorkListCard
              item={item}
              isOwn={item.owner.userId === userId}
              likePending={toggleLike.isPending}
              onPress={() =>
                router.push({
                  pathname: "/public-work-list",
                  params: { id: String(item.id) },
                })
              }
              onPressLike={() => onPressLike(item)}
              onPressReport={() => setReportTarget(item)}
            />
          )}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-center text-muted">
                {t("まだ公開されている作品リストはありません")}
              </Text>
            </View>
          }
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.primaryText} />
              </View>
            ) : undefined
          }
        />
      )}

      <WorkListReportSheet
        visible={reportTarget !== null}
        pending={reportFlow.isPending}
        onSelect={onSelectReason}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

function PublicWorkListCard({
  item,
  isOwn,
  likePending,
  onPress,
  onPressLike,
  onPressReport,
}: {
  item: PublicWorkListItem;
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
      testID={`public-work-list-${item.id}`}
    >
      {/* カード本体は詳細画面へ遷移。いいね・通報は内側の個別ボタン。
          サムネイルも個別のボタン（作品詳細）なので、Web の <button>
          入れ子を避ける CardPressable でカード側を作る。 */}
      <CardPressable
        onPress={onPress}
        accessibilityLabel={t("「{{title}}」を開く", { title: item.title })}
        testID={`public-work-list-open-${item.id}`}
      >
        {item.thumbnails.length > 0 ? (
          <View className="mb-2 flex-row gap-1.5">
            {item.thumbnails.map((thumb) => (
              // Web ではカード全面のボタンがコンテンツの下に敷かれるため、
              // 個別作品ボタンのイベントを pointerEvents="auto" で復活させる
              // （ui/card-pressable/CardPressable.web.tsx 参照）
              <View key={thumb.annictWorkId} pointerEvents="auto">
                <WorkDetailPressable work={thumb}>
                  <WorkThumbnail
                    uri={thumb.hostedImageUrl}
                    title={thumb.title}
                    width={40}
                    height={56}
                  />
                </WorkDetailPressable>
              </View>
            ))}
          </View>
        ) : null}
        <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
          {item.title}
        </Text>
        <Text className="mt-0.5 text-xs text-muted">
          {item.owner.username} ・{" "}
          {t("{{count}} 作品", { count: item.itemCount })}
        </Text>
      </CardPressable>
      <View className="mt-2 flex-row items-center justify-between">
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-md px-1.5 py-1"
          onPress={onPressLike}
          // 自分のリストにはいいね不可（API 側も 400 で弾く）。
          disabled={isOwn || likePending}
          accessibilityRole="button"
          accessibilityLabel={
            item.likedByMe
              ? t("「{{title}}」のいいねを取り消す", { title: item.title })
              : t("「{{title}}」にいいね", { title: item.title })
          }
          accessibilityState={{ disabled: isOwn || likePending }}
          testID={`work-list-like-${item.id}`}
        >
          <Ionicons
            name={item.likedByMe ? "heart" : "heart-outline"}
            size={18}
            color={
              isOwn
                ? colors.border
                : item.likedByMe
                  ? colors.danger
                  : colors.textMuted
            }
          />
          <Text
            className={`text-sm font-medium ${
              item.likedByMe ? "text-danger" : "text-muted"
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
            accessibilityLabel={t("「{{name}}」を通報", { name: item.title })}
            testID={`work-list-report-${item.id}`}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
            <Text className="text-xs text-muted">{t("通報")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
