import { useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/lib/theme";
import {
  useMergedTierLists,
  TIER_KIND_LABELS,
  type MergedTierListItem,
} from "@/lib/tierList/useMergedTierLists";
import { useWorkLists } from "@/lib/workList/useWorkLists";
import { CharacterTierWorkPicker } from "@/components/tier-list/CharacterTierWorkPicker";
import type { TierItem } from "@/lib/tierList/types";

// 横スクロールは「最近作ったもの」の入口。「すべて見る」で全件管理する
// ハブ画面へ行けるため、先頭だけを出す。
const RAIL_MAX_ITEMS = 10;

const KIND_BADGE_STYLES: Record<MergedTierListItem["kind"], string> = {
  season:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  character: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  custom:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

/**
 * ひろばタブの「つくる」セクション（issue #352）。
 *
 * 新規作成ボタン（作品 Tier・キャラ Tier・自由 Tier・作品リスト）のあとに
 * アニメ分析カード、自分が作った Tier 表・作品リストの横スクロールを置く。
 * 各カードは対応する編集画面へ、末尾の「すべて見る」は管理ハブ画面へ遷移する。
 */
export function CreateSection() {
  const router = useRouter();
  const colors = useThemeColors();
  const [pickerOpen, setPickerOpen] = useState(false);

  const mergedTierLists = useMergedTierLists();
  const workLists = useWorkLists();
  const tierItems = mergedTierLists.items.slice(0, RAIL_MAX_ITEMS);

  const openTierItem = (item: MergedTierListItem) => {
    if (item.kind === "season") {
      router.push({
        pathname: "/tier-list",
        params: { season: item.id },
      });
      return;
    }
    if (item.kind === "character") {
      router.push({
        pathname: "/character-tier-list",
        params: { workId: item.id },
      });
      return;
    }
    router.push({
      pathname: "/custom-tier-list",
      params: { id: item.id },
    });
  };

  // ピッカーで選んだ作品でキャラクター tier 表を開く。
  const openCharacterTierList = (work: TierItem) => {
    setPickerOpen(false);
    router.push({
      pathname: "/character-tier-list",
      params: { workId: String(work.id), workTitle: work.title },
    });
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8 pt-1">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        新しく作る
      </Text>
      <View className="mt-3 flex-row gap-3">
        <CreateTile
          icon="trophy-outline"
          tint="indigo"
          label="作品 Tier"
          sub="シーズンの作品を振り分け"
          onPress={() => router.push("/tier-list")}
          testID="hiroba-create-work-tier"
        />
        <CreateTile
          icon="people-outline"
          tint="rose"
          label="キャラ Tier"
          sub="作品のキャラを並べる"
          onPress={() => setPickerOpen(true)}
          testID="hiroba-create-character-tier"
        />
      </View>
      <View className="mt-3 flex-row gap-3">
        <CreateTile
          icon="sparkles-outline"
          tint="emerald"
          label="自由 Tier"
          sub="好きなテーマで作る"
          onPress={() => router.push("/custom-tier-list")}
          testID="hiroba-create-custom-tier"
        />
        <CreateTile
          icon="list-outline"
          tint="amber"
          label="作品リスト"
          sub="テーマ別リストを作る"
          onPress={() => router.push("/work-list")}
          testID="hiroba-create-work-list"
        />
      </View>

      {/* アニメ分析カード。プロフィール下部の既存導線と同じ画面を開く。 */}
      <TouchableOpacity
        className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950"
        onPress={() => router.push("/analysis")}
        accessibilityRole="button"
        accessibilityLabel="AI 視聴傾向分析を開く"
        testID="hiroba-analysis-card"
      >
        <View className="flex-row items-center gap-1.5">
          <Ionicons
            name="analytics-outline"
            size={16}
            color={colors.primaryText}
          />
          <Text className="text-base font-semibold text-violet-700 dark:text-violet-300">
            AI 視聴傾向分析
          </Text>
        </View>
        <Text className="mt-1 text-sm text-violet-900/70 dark:text-violet-200/70">
          視聴履歴をもとに、AI が傾向とおすすめを分析します
        </Text>
      </TouchableOpacity>

      <RailHeader
        title="Tier 表"
        onSeeAll={() => router.push("/tier-lists")}
        seeAllTestID="hiroba-tier-rail-see-all"
      />
      {mergedTierLists.isLoading ? (
        <View className="items-center py-6">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : mergedTierLists.isError ? (
        <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          一覧を取得できませんでした
        </Text>
      ) : tierItems.length === 0 ? (
        <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          まだありません。上のボタンから作れます
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerClassName="gap-3"
          testID="hiroba-tier-rail"
        >
          {tierItems.map((item) => (
            <TouchableOpacity
              key={item.key}
              className="w-40 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              onPress={() => openTierItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`${TIER_KIND_LABELS[item.kind]}の Tier 表「${item.title}」を開く`}
              testID={`hiroba-tier-item-${item.key}`}
            >
              <View className="self-start">
                <Text
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_BADGE_STYLES[item.kind]}`}
                >
                  {TIER_KIND_LABELS[item.kind]}
                </Text>
              </View>
              <Text
                className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100"
                numberOfLines={2}
              >
                {item.title}
              </Text>
              {item.shared ? (
                <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  共有中
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <RailHeader
        title="作品リスト"
        onSeeAll={() => router.push("/work-lists")}
        seeAllTestID="hiroba-work-list-rail-see-all"
      />
      {workLists.isLoading ? (
        <View className="items-center py-6">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : workLists.isError ? (
        <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          一覧を取得できませんでした
        </Text>
      ) : (workLists.data ?? []).length === 0 ? (
        <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          まだありません。「作品リスト」から作れます
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerClassName="gap-3"
          testID="hiroba-work-list-rail"
        >
          {(workLists.data ?? []).slice(0, RAIL_MAX_ITEMS).map((item) => (
            <TouchableOpacity
              key={item.id}
              className="w-40 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              onPress={() =>
                router.push({
                  pathname: "/work-list",
                  params: { id: String(item.id) },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`作品リスト「${item.title}」を開く`}
              testID={`hiroba-work-list-item-${item.id}`}
            >
              <Text
                className="text-sm font-medium text-slate-900 dark:text-slate-100"
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                {item.itemCount} 作品{item.shareToken ? " ・ 共有中" : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <CharacterTierWorkPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={openCharacterTierList}
      />
    </ScrollView>
  );
}

const TILE_TINTS = {
  indigo: {
    tile: "border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950",
    label: "text-indigo-700 dark:text-indigo-300",
    sub: "text-indigo-900/70 dark:text-indigo-200/70",
  },
  rose: {
    tile: "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950",
    label: "text-rose-700 dark:text-rose-300",
    sub: "text-rose-900/70 dark:text-rose-200/70",
  },
  emerald: {
    tile: "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
    label: "text-emerald-700 dark:text-emerald-300",
    sub: "text-emerald-900/70 dark:text-emerald-200/70",
  },
  amber: {
    tile: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
    label: "text-amber-700 dark:text-amber-300",
    sub: "text-amber-900/70 dark:text-amber-200/70",
  },
} as const;

function CreateTile({
  icon,
  tint,
  label,
  sub,
  onPress,
  testID,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  tint: keyof typeof TILE_TINTS;
  label: string;
  sub: string;
  onPress: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  const styles = TILE_TINTS[tint];
  return (
    <TouchableOpacity
      className={`flex-1 rounded-xl border p-3.5 ${styles.tile}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}を作る`}
      testID={testID}
    >
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={15} color={colors.primaryText} />
        <Text className={`text-sm font-semibold ${styles.label}`}>{label}</Text>
      </View>
      <Text className={`mt-1 text-xs ${styles.sub}`}>{sub}</Text>
    </TouchableOpacity>
  );
}

function RailHeader({
  title,
  onSeeAll,
  seeAllTestID,
}: {
  title: string;
  onSeeAll: () => void;
  seeAllTestID: string;
}) {
  return (
    <View className="mt-8 flex-row items-baseline justify-between">
      <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </Text>
      <TouchableOpacity
        onPress={onSeeAll}
        accessibilityRole="button"
        accessibilityLabel={`${title}をすべて見る`}
        testID={seeAllTestID}
      >
        <Text className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          すべて見る
        </Text>
      </TouchableOpacity>
    </View>
  );
}
