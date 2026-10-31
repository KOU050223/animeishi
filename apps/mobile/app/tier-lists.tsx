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
import { useThemeColors } from "@/lib/theme";
import {
  useCustomTierLists,
  useDeleteCustomTierList,
} from "@/lib/tierList/useCustomTierList";

/**
 * Tier 表の作成導線と自由作成一覧のハブ（issue #348）。
 *
 * 「シーズンから作る」（従来の tier-list.tsx）と「テーマを決めて自由に作る」
 * （custom-tier-list.tsx）をここで選ばせる。自由作成は 1 人で複数持てる
 * ため、作成済みの表もここから開き直す。
 */
export default function TierListsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const lists = useCustomTierLists();
  const remove = useDeleteCustomTierList();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const handleDelete = (id: number, title: string) => {
    confirm(
      "この Tier 表を削除しますか？",
      `「${title}」を削除します。共有リンクも無効になり、この操作は取り消せません。`,
      () => {
        remove.mutate(id, {
          onError: () =>
            alert("削除に失敗しました", "時間をおいて再度お試しください。", {
              okLabel: "OK",
            }),
        });
      },
      {
        confirmLabel: "削除する",
        cancelLabel: "キャンセル",
        destructive: true,
      },
    );
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
          テーマ別の Tier 表
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
            data={lists.data ?? []}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View className="mb-2 flex-row items-center rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                <TouchableOpacity
                  className="flex-1"
                  onPress={() =>
                    router.push({
                      pathname: "/custom-tier-list",
                      params: { id: String(item.id) },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を開く`}
                  testID={`tier-lists-item-${item.id}`}
                >
                  <Text
                    className="text-base font-medium text-slate-900 dark:text-slate-100"
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.shareToken ? (
                    <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      共有中
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(item.id, item.title)}
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を削除`}
                  testID={`tier-lists-delete-${item.id}`}
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
                まだありません。「テーマを決めて自由に作る」から作れます
              </Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
