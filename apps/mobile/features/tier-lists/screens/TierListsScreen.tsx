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
import { useTranslation } from "react-i18next";
import { BackButton } from "@/components/ui";
import { alert, confirm } from "@/lib/dialog";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme";
import { featureFlags } from "@/lib/featureFlags";
import { useDeleteTierList } from "@/features/tier-lists/useTierList";
import {
  useMergedTierLists,
  TIER_KIND_LABELS,
  type MergedTierListItem,
} from "@/features/tier-lists/useMergedTierLists";
import { CharacterTierWorkPicker } from "@/features/tier-lists/components/CharacterTierWorkPicker";
import type { TierItem } from "@/features/tier-lists/types";

const KIND_BADGE_STYLES: Record<MergedTierListItem["kind"], string> = {
  season:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  character: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  custom: "bg-emerald-100 text-success-text dark:bg-emerald-950",
};

/**
 * Tier 表の作成導線と作成済み一覧のハブ（issue #348）。
 *
 * 「シーズンから作る」・「作品を選んでキャラで作る」・「テーマを決めて
 * 自由に作る」をここで選ばせる（編集は tier-list.tsx の 1 画面に統合。
 * issue #724）。キャラ版・自由版は機能フラグが有効なときだけ選択肢に
 * 出す。作成済みの表は 3 種類ともここから開き直せる（#352 で全種類の
 * 一覧に拡張）。
 */
export function TierListsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const lists = useMergedTierLists();
  const remove = useDeleteTierList();
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
      t("この Tier 表を削除しますか？"),
      t(
        "「{{title}}」を削除します。共有リンクも無効になり、この操作は取り消せません。",
        {
          title: item.title,
        },
      ),
      () => {
        haptics.warning();
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う
        // （FavoritesSection と同じ方式）。scope は削除後に編集画面の
        // 保存済みキャッシュも消すために渡す。
        const scope =
          item.kind === "season" && item.season
            ? { kind: "season" as const, season: item.season }
            : item.kind === "character" && item.annictWorkId
              ? { kind: "character" as const, annictWorkId: item.annictWorkId }
              : undefined;
        void remove
          .mutateAsync(scope ? { id: item.id, scope } : { id: item.id })
          .catch(() =>
            alert(
              t("削除に失敗しました"),
              t("時間をおいて再度お試しください。"),
              {
                okLabel: "OK",
              },
            ),
          );
      },
      {
        confirmLabel: t("削除する"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  };

  const handleOpen = (item: MergedTierListItem) => {
    if (item.kind === "season") {
      router.push({
        pathname: "/tier-list",
        params: { season: item.season ?? "" },
      });
      return;
    }
    if (item.kind === "character") {
      router.push({
        pathname: "/tier-list",
        params: {
          kind: "character",
          workId: String(item.annictWorkId ?? ""),
        },
      });
      return;
    }
    router.push({
      pathname: "/tier-list",
      params: { kind: "custom", id: String(item.id) },
    });
  };

  // ピッカーで選んだ作品でキャラクター tier 表を開く。
  const openCharacterTierList = (work: TierItem) => {
    setPickerOpen(false);
    router.push({
      pathname: "/tier-list",
      params: {
        kind: "character",
        workId: String(work.id),
        workTitle: work.title,
      },
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
          title: t("Tier 表"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="tier-lists-back"
            />
          ),
        }}
      />
      <View className="w-full max-w-2xl flex-1 self-center px-6 pb-4 pt-4">
        <Text className="mt-4 text-base font-semibold text-foreground">
          {t("新しく作る")}
        </Text>
        <View className="mt-3 gap-3">
          <TouchableOpacity
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
            onPress={() => router.push("/tier-list")}
            accessibilityRole="button"
            accessibilityLabel={t("シーズンから作る")}
            testID="tier-lists-create-season"
          >
            <Text className="text-base font-semibold text-indigo-700 dark:text-indigo-300">
              {t("シーズンから作る")}
            </Text>
            <Text className="mt-1 text-sm text-indigo-900/70 dark:text-indigo-200/70">
              {t("放送シーズンの全作品を並べて振り分けます")}
            </Text>
          </TouchableOpacity>
          {featureFlags.characterTierList ? (
            <TouchableOpacity
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950"
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("キャラクターで作る")}
              testID="tier-lists-create-character"
            >
              <Text className="text-base font-semibold text-rose-700 dark:text-rose-300">
                {t("キャラクターで作る")}
              </Text>
              <Text className="mt-1 text-sm text-rose-900/70 dark:text-rose-200/70">
                {t("作品を選んで、そのキャラクターを並べて振り分けます")}
              </Text>
            </TouchableOpacity>
          ) : null}
          {featureFlags.customTierList ? (
            <TouchableOpacity
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950"
              onPress={() =>
                router.push({
                  pathname: "/tier-list",
                  params: { kind: "custom" },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={t("テーマを決めて自由に作る")}
              testID="tier-lists-create-custom"
            >
              <Text className="text-base font-semibold text-success-text">
                {t("テーマを決めて自由に作る")}
              </Text>
              <Text className="mt-1 text-sm text-success-text">
                {t(
                  "「歴代で好きなアニメ」など好きなテーマで、作品を検索して追加します",
                )}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text className="mt-10 text-base font-semibold text-foreground">
          {t("作った Tier 表")}
        </Text>
        {lists.isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : lists.isError ? (
          <Text className="mt-3 text-sm text-muted">
            {t("一覧を取得できませんでした")}
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
                  accessibilityLabel={t("「{{title}}」を開く", {
                    title: item.title,
                  })}
                  testID={`tier-lists-item-${item.key}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Text
                      className={`self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_BADGE_STYLES[item.kind]}`}
                    >
                      {t(TIER_KIND_LABELS[item.kind])}
                    </Text>
                    <Text
                      className="flex-1 text-base font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                  </View>
                  {item.shared || item.isPublic ? (
                    <Text className="mt-0.5 text-xs text-muted">
                      {[
                        item.shared ? t("リンク共有中") : null,
                        item.isPublic ? t("ひろばに公開中") : null,
                      ]
                        .filter(Boolean)
                        .join(" ・ ")}
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={t("「{{title}}」を削除", {
                    title: item.title,
                  })}
                  testID={`tier-lists-delete-${item.key}`}
                  className="ml-3 rounded-md px-2 py-1"
                >
                  <Text className="text-sm font-medium text-danger">
                    {t("削除")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text className="mt-3 text-sm text-muted">
                {t("まだありません。上のボタンから作れます")}
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
