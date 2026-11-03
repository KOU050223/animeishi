import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useRouter } from "expo-router";
import { BackButton } from "@/components/ui";
import { alert, confirm } from "@/lib/dialog";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme";
import { useDeleteCustomTierList } from "@/lib/tierList/useCustomTierList";
import { useDeleteTierList } from "@/lib/tierList/useTierList";
import { useDeleteCharacterTierList } from "@/lib/tierList/useCharacterTierList";
import {
  useMergedTierLists,
  TIER_KIND_LABELS,
  type MergedTierListItem,
} from "@/lib/tierList/useMergedTierLists";
import { CharacterTierWorkPicker } from "@/components/tier-list/CharacterTierWorkPicker";
import type { TierItem } from "@/lib/tierList/types";

const KIND_BADGE_STYLES: Record<MergedTierListItem["kind"], string> = {
  season:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  character: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  custom:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

/**
 * Tier 表の作成導線と作成済み一覧のハブ（issue #348）。
 *
 * 「シーズンから作る」（従来の tier-list.tsx）・「作品を選んでキャラで
 * 作る」（character-tier-list.tsx）・「テーマを決めて自由に作る」
 * （custom-tier-list.tsx）をここで選ばせる。作成済みの表は 3 種類とも
 * ここから開き直せる（#352 で全種類の一覧に拡張）。
 */
export default function TierListsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const lists = useMergedTierLists();
  const removeSeason = useDeleteTierList();
  const removeCharacter = useDeleteCharacterTierList();
  const removeCustom = useDeleteCustomTierList();
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const handleDelete = (item: MergedTierListItem) => {
    confirm(
      "この Tier 表を削除しますか？",
      `「${item.title}」を削除します。共有リンクも無効になり、この操作は取り消せません。`,
      () => {
        haptics.warning();
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う
        // （FavoritesSection と同じ方式）。
        const remove =
          item.kind === "season"
            ? removeSeason.mutateAsync(item.id)
            : item.kind === "character"
              ? removeCharacter.mutateAsync(Number(item.id))
              : removeCustom.mutateAsync(Number(item.id));
        void remove.catch(() =>
          alert("削除に失敗しました", "時間をおいて再度お試しください。", {
            okLabel: "OK",
          }),
        );
      },
      {
        confirmLabel: "削除する",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
  };

  const handleOpen = (item: MergedTierListItem) => {
    if (item.kind === "season") {
      router.push({ pathname: "/tier-list", params: { season: item.id } });
      return;
    }
    if (item.kind === "character") {
      router.push({
        pathname: "/character-tier-list",
        params: { workId: item.id },
      });
      return;
    }
    router.push({ pathname: "/custom-tier-list", params: { id: item.id } });
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
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {/* 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。
          headerLeft を自前で出すのは、直リンク時にホームへ戻す規約と
          E2E が参照する testID を維持するため。 */}
      <Stack.Screen
        options={{
          title: "Tier 表",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="tier-lists-back"
            />
          ),
        }}
      />
      <View className="w-full max-w-2xl flex-1 self-center px-6 pb-4 pt-4">
        <Text className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
          新しく作る
        </Text>
        <View className="mt-3 gap-3">
          <TouchableOpacity
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
            onPress={() => router.push("/tier-list")}
            accessibilityRole="button"
            accessibilityLabel="シーズンから作る"
            testID="tier-lists-create-season"
          >
            <Text className="text-base font-semibold text-indigo-700 dark:text-indigo-300">
              シーズンから作る
            </Text>
            <Text className="mt-1 text-sm text-indigo-900/70 dark:text-indigo-200/70">
              放送シーズンの全作品を並べて振り分けます
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950"
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="キャラクターで作る"
            testID="tier-lists-create-character"
          >
            <Text className="text-base font-semibold text-rose-700 dark:text-rose-300">
              キャラクターで作る
            </Text>
            <Text className="mt-1 text-sm text-rose-900/70 dark:text-rose-200/70">
              作品を選んで、そのキャラクターを並べて振り分けます
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950"
            onPress={() => router.push("/custom-tier-list")}
            accessibilityRole="button"
            accessibilityLabel="テーマを決めて自由に作る"
            testID="tier-lists-create-custom"
          >
            <Text className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
              テーマを決めて自由に作る
            </Text>
            <Text className="mt-1 text-sm text-emerald-900/70 dark:text-emerald-200/70">
              「歴代で好きなアニメ」など好きなテーマで、作品を検索して追加します
            </Text>
          </TouchableOpacity>
        </View>

        <Text className="mt-10 text-base font-semibold text-slate-900 dark:text-slate-100">
          作った Tier 表
        </Text>
        {lists.isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : lists.isError ? (
          <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            一覧を取得できませんでした
          </Text>
        ) : (
          <FlatList
            className="mt-3"
            data={lists.items}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => (
              <View className="mb-2 flex-row items-center rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                <TouchableOpacity
                  className="flex-1"
                  onPress={() => handleOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を開く`}
                  testID={`tier-lists-item-${item.key}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Text
                      className={`self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_BADGE_STYLES[item.kind]}`}
                    >
                      {TIER_KIND_LABELS[item.kind]}
                    </Text>
                    <Text
                      className="flex-1 text-base font-medium text-slate-900 dark:text-slate-100"
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                  </View>
                  {item.shared ? (
                    <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      共有中
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を削除`}
                  testID={`tier-lists-delete-${item.key}`}
                  className="ml-3 rounded-md px-2 py-1"
                >
                  <Text className="text-sm font-medium text-red-500 dark:text-red-400">
                    削除
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                まだありません。上のボタンから作れます
              </Text>
            }
          />
        )}
      </View>

      <CharacterTierWorkPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={openCharacterTierList}
      />
    </SafeAreaView>
  );
}
