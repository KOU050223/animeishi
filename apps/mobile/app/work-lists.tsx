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
import { useWorkLists, useDeleteWorkList } from "@/lib/workList/useWorkLists";

/**
 * オリジナル作品リストの一覧（issue #349）。
 *
 * 「ゆるく周回するアニメ」「必修アニメ」のようなテーマ別のリストを
 * 1 人で複数持てるため、作成済みのリストもここから開き直す。
 * 入口はライブラリタブの推しセクション（#352 で置き場所を再検討中）。
 */
export default function WorkListsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const lists = useWorkLists();
  const remove = useDeleteWorkList();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/library?section=favorites");
  };

  const handleDelete = (id: number, title: string) => {
    confirm(
      "この作品リストを削除しますか？",
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
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View className="w-full max-w-2xl flex-1 self-center px-6 pb-4 pt-4">
        <BackButton
          onPress={handleBack}
          className="-ml-2 mb-4 self-start"
          accessibilityLabel="戻る"
          testID="work-lists-back"
        />

        <Text className="text-2xl font-bold text-gray-900 dark:text-slate-100">
          作品リスト
        </Text>

        <View className="mt-6">
          <TouchableOpacity
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
            onPress={() => router.push("/work-list")}
            accessibilityRole="button"
            accessibilityLabel="新しいリストを作る"
            testID="work-lists-create"
          >
            <Text className="text-base font-semibold text-indigo-700 dark:text-indigo-300">
              新しいリストを作る
            </Text>
            <Text className="mt-1 text-sm text-indigo-900/70 dark:text-indigo-200/70">
              「必修アニメ」など好きなテーマで、作品を検索して並べます
            </Text>
          </TouchableOpacity>
        </View>

        <Text className="mt-10 text-base font-semibold text-gray-900 dark:text-slate-100">
          作ったリスト
        </Text>
        {lists.isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : lists.isError ? (
          <Text className="mt-3 text-sm text-gray-500 dark:text-slate-400">
            一覧を取得できませんでした
          </Text>
        ) : (
          <FlatList
            className="mt-3"
            data={lists.data ?? []}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View className="mb-2 flex-row items-center rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
                <TouchableOpacity
                  className="flex-1"
                  onPress={() =>
                    router.push({
                      pathname: "/work-list",
                      params: { id: String(item.id) },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を開く`}
                  testID={`work-lists-item-${item.id}`}
                >
                  <Text
                    className="text-base font-medium text-gray-900 dark:text-slate-100"
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {item.itemCount} 作品
                    {item.shareToken ? " ・ 共有中" : ""}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(item.id, item.title)}
                  accessibilityRole="button"
                  accessibilityLabel={`「${item.title}」を削除`}
                  testID={`work-lists-delete-${item.id}`}
                  className="ml-3 rounded-md px-2 py-1"
                >
                  <Text className="text-sm font-medium text-red-500 dark:text-red-400">
                    削除
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text className="mt-3 text-sm text-gray-500 dark:text-slate-400">
                まだありません。「新しいリストを作る」から作れます
              </Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
