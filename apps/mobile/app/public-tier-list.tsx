import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";
import { useThemeColors } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import {
  usePublicTierList,
  useToggleTierListLike,
} from "@/lib/tierList/usePublicTierLists";
import { useReportTierListFlow } from "@/lib/tierList/useReportTierListFlow";
import {
  TIER_KIND_LABELS,
  type TierListKind,
} from "@/lib/tierList/useMergedTierLists";
import { tierLabelFontSize, tierLabelTextColor } from "@/lib/tierList/label";
import { DiscoverReportSheet } from "@/components/hiroba/DiscoverReportSheet";
import type { ReportReason } from "@/lib/useModeration";

const TIER_LIST_KINDS: readonly TierListKind[] = [
  "season",
  "character",
  "custom",
];

type PublicTierListDetail = NonNullable<
  ReturnType<typeof usePublicTierList>["data"]
>;
type PublicTierListItem = PublicTierListDetail["items"][number];

function parseKindParam(kind: string | undefined): TierListKind | null {
  return TIER_LIST_KINDS.find((k) => k === kind) ?? null;
}

function NotFound() {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text
        className="text-center text-slate-500 dark:text-slate-400"
        testID="public-tier-list-not-found"
      >
        この Tier 表は表示できません
      </Text>
    </View>
  );
}

function Loading({ colors }: { colors: ThemeColors }) {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={colors.textMuted} />
    </View>
  );
}

function DetailHeader({
  data,
  isOwn,
  likePending,
  colors,
  onPressOwner,
  onPressLike,
  onPressReport,
}: {
  data: PublicTierListDetail;
  isOwn: boolean;
  likePending: boolean;
  colors: ThemeColors;
  onPressOwner: () => void;
  onPressLike: () => void;
  onPressReport: () => void;
}) {
  const likeDisabled = isOwn || likePending;
  return (
    <View className="pb-4 pt-4">
      <Text className="text-xs text-slate-500 dark:text-slate-400">
        {TIER_KIND_LABELS[data.kind]} Tier 表
        {data.kind === "character" && data.workTitle
          ? ` ・ ${data.workTitle}`
          : ""}
      </Text>
      <Text className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
        {data.title}
      </Text>
      {data.description ? (
        <Text className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
          {data.description}
        </Text>
      ) : null}
      <TouchableOpacity
        className="mt-2 flex-row items-center"
        onPress={onPressOwner}
        accessibilityRole="button"
        accessibilityLabel={`${data.owner.username}のプロフィールを見る`}
        testID="public-tier-list-owner"
      >
        <Text className="text-sm text-indigo-600 dark:text-indigo-400">
          {data.owner.username}
        </Text>
      </TouchableOpacity>
      <View className="mt-3 flex-row items-center justify-between">
        <TouchableOpacity
          className="flex-row items-center gap-1.5 rounded-md px-1.5 py-1"
          onPress={onPressLike}
          // 自分のリストにはいいね不可（API 側も 400 で弾く）。
          disabled={likeDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            data.likedByMe ? "いいねを取り消す" : "いいねする"
          }
          accessibilityState={{ disabled: likeDisabled }}
          testID="public-tier-list-like"
        >
          <Ionicons
            name={data.likedByMe ? "heart" : "heart-outline"}
            size={22}
            color={
              isOwn
                ? colors.textFaint
                : data.likedByMe
                  ? colors.danger
                  : colors.textMuted
            }
          />
          <Text
            className={`text-base font-medium ${
              data.likedByMe
                ? "text-red-500 dark:text-red-400"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {data.likeCount}
          </Text>
        </TouchableOpacity>
        {isOwn ? null : (
          <TouchableOpacity
            className="flex-row items-center gap-1 rounded-md px-2 py-1.5"
            onPress={onPressReport}
            accessibilityRole="button"
            accessibilityLabel="この Tier 表を通報"
            testID="public-tier-list-report"
          >
            <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              通報
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function itemTitle(item: PublicTierListItem): string {
  return item.kind === "work" ? item.title : item.name;
}

function itemImageUrl(item: PublicTierListItem): string | null {
  return item.kind === "work" ? item.hostedImageUrl : item.imageUrl;
}

function itemKey(item: PublicTierListItem): string {
  return item.kind === "work"
    ? `work-${item.annictWorkId}`
    : `character-${item.annictCharacterId}`;
}

const ITEM_CARD_SIZE = 56;

/**
 * 閲覧専用の tier 行。ドラッグ&ドロップの TierBoard は編集用なので、
 * 公開一覧の詳細ではラベル＋カードの並びだけを描く
 * （TierBoardSnapshot の画面内版）。
 */
function TierRowView({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: PublicTierListItem[];
}) {
  return (
    <View className="mb-1.5 flex-row" testID={`public-tier-list-row-${label}`}>
      <View
        className="w-14 items-center justify-center p-1"
        style={{ backgroundColor: color }}
      >
        <Text
          style={{
            fontSize: tierLabelFontSize(label, 14),
            color: tierLabelTextColor(color),
            fontWeight: "700",
            textAlign: "center",
          }}
          numberOfLines={3}
        >
          {label}
        </Text>
      </View>
      <View className="flex-1 flex-row flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 dark:bg-slate-800">
        {items.map((item) => (
          <View key={itemKey(item)} style={{ width: ITEM_CARD_SIZE }}>
            <WorkImage
              uri={itemImageUrl(item)}
              style={{
                width: ITEM_CARD_SIZE,
                height: ITEM_CARD_SIZE,
                borderRadius: 4,
              }}
              placeholder=<View
                style={{
                  width: ITEM_CARD_SIZE,
                  height: ITEM_CARD_SIZE,
                  borderRadius: 4,
                }}
                className="bg-slate-200 dark:bg-slate-700"
              />
            />
            <Text
              className="mt-0.5 text-center text-[9px] leading-3 text-slate-700 dark:text-slate-300"
              numberOfLines={2}
            >
              {itemTitle(item)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ScreenContent({
  kind,
  listId,
  isHidden,
  isLoading,
  data,
  isOwn,
  likePending,
  colors,
  onPressOwner,
  onPressLike,
  onPressReport,
}: {
  kind: TierListKind | null;
  listId: number | null;
  isHidden: boolean;
  isLoading: boolean;
  data: PublicTierListDetail | undefined;
  isOwn: boolean;
  likePending: boolean;
  colors: ThemeColors;
  onPressOwner: () => void;
  onPressLike: () => void;
  onPressReport: () => void;
}) {
  if (kind === null || listId === null || isHidden) {
    return <NotFound />;
  }
  if (isLoading || !data) {
    return <Loading colors={colors} />;
  }
  // 保存 API は item id の重複を弾くが、旧データに重複行が残っていた
  // 場合でも同一作品は 1 件だけ出す（issue #521）。
  const seenItemKeys = new Set<string>();
  const displayItems = data.items.filter((item) => {
    const key = itemKey(item);
    if (seenItemKeys.has(key)) return false;
    seenItemKeys.add(key);
    return true;
  });
  return (
    <ScrollView
      className="w-full max-w-2xl self-center px-6"
      testID="public-tier-list-items"
    >
      <DetailHeader
        data={data}
        isOwn={isOwn}
        likePending={likePending}
        colors={colors}
        onPressOwner={onPressOwner}
        onPressLike={onPressLike}
        onPressReport={onPressReport}
      />
      <View className="pb-8">
        {data.tiers.map((tier) => (
          <TierRowView
            key={tier.key}
            label={tier.label}
            color={tier.color}
            items={displayItems.filter((item) => item.tierKey === tier.key)}
          />
        ))}
        {data.items.length === 0 ? (
          <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
            アイテムが登録されていません
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * 公開 tier 表の閲覧画面（issue #418）。
 * ひろば「みつける」のカードから遷移し、tier 行ごとの配置を
 * 読み取り専用で表示する。いいね・通報の導線を持つ。
 * 一覧と同じ可視条件で解決するため、開けないリストはエラー表示にする
 * （非公開化・ブロックで開いたあとに見えなくなった場合も同じ扱い）。
 */
export default function PublicTierListScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const kind = parseKindParam(params.kind);
  const idParam = params.id !== undefined ? Number(params.id) : NaN;
  const listId = Number.isFinite(idParam) && idParam > 0 ? idParam : null;

  const detail = usePublicTierList(kind ?? "season", kind ? listId : null);
  const toggleLike = useToggleTierListLike();
  const reportFlow = useReportTierListFlow();
  const [reportSheetOpen, setReportSheetOpen] = useState(false);

  const data = detail.data;
  const isOwn = !!data && data.owner.userId === userId;
  // TanStack Query はバックグラウンド再取得の失敗でも data を保持したまま
  // isError を立てる。一時的な再取得エラーで表示中の内容を消さないよう、
  // データがない・または 404 のときだけ NotFound にする。
  const isHidden =
    detail.isError &&
    (!data ||
      (detail.error instanceof ApiRequestError && detail.error.status === 404));

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/hiroba");
  };

  const onPressLike = () => {
    if (!data || !kind || isOwn) return;
    toggleLike.mutate(
      { kind, id: data.id, like: !data.likedByMe },
      {
        onError: () =>
          alert("いいねできませんでした", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
      },
    );
  };

  const onSelectReason = (reason: ReportReason) => {
    setReportSheetOpen(false);
    if (!data || !kind) return;
    reportFlow.submit({
      kind,
      id: data.id,
      ownerUserId: data.owner.userId,
      ownerUsername: data.owner.username,
      reason,
    });
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: data?.title ?? "Tier 表",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="public-tier-list-back"
            />
          ),
        }}
      />
      <ScreenContent
        kind={kind}
        listId={listId}
        isHidden={isHidden}
        isLoading={detail.isLoading}
        data={data}
        isOwn={isOwn}
        likePending={toggleLike.isPending}
        colors={colors}
        onPressOwner={() => {
          if (!data) return;
          router.push({
            pathname: "/user/[uid]",
            params: { uid: data.owner.userId },
          });
        }}
        onPressLike={onPressLike}
        onPressReport={() => setReportSheetOpen(true)}
      />

      <DiscoverReportSheet
        visible={reportSheetOpen}
        pending={reportFlow.isPending}
        title="この Tier 表を通報"
        testIdPrefix="tier-list-report"
        onSelect={onSelectReason}
        onClose={() => setReportSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
