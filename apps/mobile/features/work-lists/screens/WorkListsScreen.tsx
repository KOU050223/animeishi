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
import {
  useWorkLists,
  useDeleteWorkList,
} from "@/features/work-lists/useWorkLists";

/**
 * オリジナル作品リストの一覧（issue #349）。
 *
 * 「ゆるく周回するアニメ」「必修アニメ」のようなテーマ別のリストを
 * 1 人で複数持てるため、作成済みのリストもここから開き直す。
 * 入口はライブラリタブの推しセクション（#352 で置き場所を再検討中）。
 */
export function WorkListsScreen() {
  const { t } = useTranslation();
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
      t("この作品リストを削除しますか？"),
      t(
        "「{{title}}」を削除します。共有リンクも無効になり、この操作は取り消せません。",
        {
          title,
        },
      ),
      () => {
        haptics.warning();
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う
        // （FavoritesSection と同じ方式）。
        void remove.mutateAsync(id).catch(() =>
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

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {/* 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。
          headerLeft を自前で出すのは、直リンク時にライブラリタブへ戻す規約と
          E2E が参照する testID を維持するため。 */}
      <Stack.Screen
        options={{
          title: t("作品リスト"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="work-lists-back"
            />
          ),
        }}
      />
      <View className="w-full max-w-2xl flex-1 self-center px-6 pb-4 pt-4">
        <View className="mt-2">
          <TouchableOpacity
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
            onPress={() => router.push("/work-list")}
            accessibilityRole="button"
            accessibilityLabel={t("新しいリストを作る")}
            testID="work-lists-create"
          >
            <Text className="text-base font-semibold text-indigo-700 dark:text-indigo-300">
              {t("新しいリストを作る")}
            </Text>
            <Text className="mt-1 text-sm text-indigo-900/70 dark:text-indigo-200/70">
              {t("「必修アニメ」など好きなテーマで、作品を検索して並べます")}
            </Text>
          </TouchableOpacity>
        </View>

        <Text className="mt-10 text-base font-semibold text-foreground">
          {t("作ったリスト")}
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
            data={lists.data ?? []}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View className="mb-2 flex-row items-center rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                <TouchableOpacity
                  className="flex-1"
                  onPress={() =>
                    router.push({
                      pathname: "/work-list",
                      params: { id: String(item.id) },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t("「{{title}}」を開く", {
                    title: item.title,
                  })}
                  testID={`work-lists-item-${item.id}`}
                >
                  <Text
                    className="text-base font-medium text-foreground"
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted">
                    {t("{{count}} 作品", { count: item.itemCount })}
                    {item.shareToken ? ` ・ ${t("共有中")}` : ""}
                    {item.isPublic ? ` ・ ${t("公開中")}` : ""}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(item.id, item.title)}
                  accessibilityRole="button"
                  accessibilityLabel={t("「{{title}}」を削除", {
                    title: item.title,
                  })}
                  testID={`work-lists-delete-${item.id}`}
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
                {t("まだありません。「新しいリストを作る」から作れます")}
              </Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
