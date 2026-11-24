import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useRouter } from "expo-router";
import { BackButton } from "@/components/ui";
import { useBlockedUsers, useUnblockUser } from "@/lib/useModeration";
import type { BlockedUserItem } from "@/lib/useModeration";
import { alert, confirm } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import { useTranslation } from "react-i18next";

export default function BlockedUsersScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { data: blocked, isLoading, isError, refetch } = useBlockedUsers();
  const unblock = useUnblockUser();

  // meishi/edit と同じ規約。遷移元はプロフィールタブの設定項目なので、
  // 直リンクで履歴が無い場合もプロフィールタブへ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/profile");
  };

  // 戻るボタンはネイティブヘッダー側に移した（issue #395 Phase 2）。
  // headerLeft を自前で出すのは、直リンク時にプロフィールタブへ戻す規約と
  // E2E が参照する testID を維持するため。
  const screenOptions = (
    <Stack.Screen
      options={{
        title: t("ブロック中のユーザー"),
        headerBackVisible: false,
        headerLeft: () => (
          <BackButton
            onPress={handleBack}
            accessibilityLabel={t("戻る")}
            testID="blocked-users-back-button"
          />
        ),
      }}
    />
  );

  function confirmUnblock(item: BlockedUserItem) {
    confirm(
      t("ブロックを解除"),
      t("「{{username}}」のブロックを解除しますか？", {
        username: item.username,
      }),
      () => {
        // 解除失敗は画面に変化が残らないため、ダイアログで必ず伝える。
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う。
        void unblock
          .mutateAsync(item.blockedId)
          .catch(() =>
            alert(
              t("ブロックを解除できませんでした"),
              t("ブロックの解除に失敗しました"),
              { okLabel: "OK" },
            ),
          );
      },
      { confirmLabel: t("解除"), cancelLabel: t("キャンセル") },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primaryText} />
      </View>
    );
  }

  if (isError) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-red-500 dark:text-red-400">
            {t("ブロック一覧の取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("ブロック一覧を再取得")}
          >
            <Text className="font-semibold text-white">{t("再試行")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const list = blocked ?? [];

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {screenOptions}
      <View className="px-4 pb-3 pt-3">
        <Text className="mt-0.5 text-xs text-muted">
          {t("{{count}} 人", { count: list.length })}
        </Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.blockedId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => (
          <View className="h-px bg-slate-100 dark:bg-slate-800" />
        )}
        renderItem={({ item }) => (
          <View
            className="flex-row items-center gap-3 py-3"
            testID={`blocked-item-${item.blockedId}`}
          >
            {item.profileImageUrl ? (
              <Image
                source={{ uri: item.profileImageUrl }}
                style={{ width: 48, height: 48, borderRadius: 24 }}
                className="bg-slate-200 dark:bg-slate-700"
                resizeMode="cover"
              />
            ) : (
              <View
                style={{ width: 48, height: 48, borderRadius: 24 }}
                className="items-center justify-center bg-indigo-100 dark:bg-indigo-900"
              >
                <Text className="font-semibold text-indigo-500 dark:text-indigo-300">
                  {item.username.charAt(0)}
                </Text>
              </View>
            )}

            <View className="flex-1">
              <Text
                className="font-medium text-slate-900 dark:text-slate-100"
                numberOfLines={1}
              >
                {item.username}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => confirmUnblock(item)}
              disabled={unblock.isPending}
              className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-1.5"
              accessibilityRole="button"
              accessibilityLabel={t("{{username}}のブロックを解除", {
                username: item.username,
              })}
            >
              <Text className="text-xs text-slate-700 dark:text-slate-200">
                {t("解除")}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-center text-muted">
              {t("ブロックしているユーザーはいません")}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
