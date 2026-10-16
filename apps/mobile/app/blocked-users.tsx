import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBlockedUsers, useUnblockUser } from "@/lib/useModeration";
import type { BlockedUserItem } from "@/lib/useModeration";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";

export default function BlockedUsersScreen() {
  const colors = useThemeColors();
  const { data: blocked, isLoading, isError, refetch } = useBlockedUsers();
  const unblock = useUnblockUser();

  function confirmUnblock(item: BlockedUserItem) {
    confirm(
      "ブロックを解除",
      `「${item.username}」のブロックを解除しますか？`,
      () =>
        unblock.mutate(item.blockedId, {
          // 解除失敗は画面に変化が残らないため、ダイアログで必ず伝える。
          // ApiRequestError はユーザー向け日本語メッセージを持つ。
          onError: (e) =>
            alert(
              "ブロックを解除できませんでした",
              e instanceof ApiRequestError
                ? e.message
                : "ブロックの解除に失敗しました",
              { okLabel: "OK" },
            ),
        }),
      { confirmLabel: "解除", cancelLabel: "キャンセル" },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="mb-4 text-center text-red-500 dark:text-red-400">
          ブロック一覧の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="rounded-lg bg-indigo-600 px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="ブロック一覧を再取得"
        >
          <Text className="font-semibold text-white">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const list = blocked ?? [];

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="px-4 pb-3 pt-3">
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          ブロック中のユーザー
        </Text>
        <Text className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
          {list.length} 人
        </Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.blockedId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => (
          <View className="h-px bg-gray-100 dark:bg-slate-800" />
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
                className="bg-gray-200 dark:bg-slate-700"
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
                className="font-medium text-gray-900 dark:text-slate-100"
                numberOfLines={1}
              >
                {item.username}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => confirmUnblock(item)}
              disabled={unblock.isPending}
              className="rounded-lg bg-gray-100 dark:bg-slate-800 px-3 py-1.5"
              accessibilityRole="button"
              accessibilityLabel={`${item.username}のブロックを解除`}
            >
              <Text className="text-xs text-gray-700 dark:text-slate-200">
                解除
              </Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-center text-gray-400 dark:text-slate-500">
              ブロックしているユーザーはいません
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
