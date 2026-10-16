import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFriends, useRemoveFriend } from "@/lib/useFriends";
import type { FriendItem } from "@/lib/useFriends";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";

export default function FriendsScreen() {
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);

  const { data: friends, isLoading, isError, refetch } = useFriends();
  const remove = useRemoveFriend();

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function confirmRemove(friendId: string, name: string) {
    confirm(
      "フレンドを削除",
      `「${name}」をフレンドから削除しますか？`,
      () => {
        // 削除失敗は画面に変化が残らないため、ダイアログで必ず伝える。
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う。
        // ApiRequestError はユーザー向け日本語メッセージを持つ。
        void remove
          .mutateAsync(friendId)
          .catch((e: unknown) =>
            alert(
              "フレンドを削除できませんでした",
              e instanceof ApiRequestError
                ? e.message
                : "フレンドの削除に失敗しました",
              { okLabel: "OK" },
            ),
          );
      },
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
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
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          フレンド一覧の取得に失敗しました
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel="フレンド一覧を再取得"
        >
          <Text className="text-white font-semibold">再試行</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const list = friends ?? [];

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-900" edges={["top"]}>
      <View className="px-4 pt-3 pb-3">
        <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
          フレンド
        </Text>
        <Text className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
          {list.length} 人
        </Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.friendId}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View
            style={styles.separator}
            className="bg-gray-100 dark:bg-slate-800"
          />
        )}
        renderItem={({ item }) => (
          <FriendRow
            friend={item}
            onRemove={() => confirmRemove(item.friendId, item.username)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 dark:text-slate-500 text-center">
              フレンドがいません。{"\n"}QR
              コードをスキャンして追加してください。
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function FriendRow({
  friend,
  onRemove,
}: {
  friend: FriendItem;
  onRemove: () => void;
}) {
  return (
    <View
      className="flex-row items-center py-3 gap-3"
      testID={`friend-item-${friend.friendId}`}
    >
      {friend.profileImageUrl ? (
        <Image
          source={{ uri: friend.profileImageUrl }}
          style={styles.avatar}
          // 画像読み込み中の下地。dark では slate-700 系に揃える。
          className="bg-gray-200 dark:bg-slate-700"
          resizeMode="cover"
        />
      ) : (
        <View
          style={styles.avatarPlaceholder}
          className="bg-indigo-100 dark:bg-indigo-900 items-center justify-center"
        >
          <Text className="text-indigo-500 dark:text-indigo-300 font-semibold">
            {friend.username.charAt(0)}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text
          className="text-gray-900 dark:text-slate-100 font-medium"
          numberOfLines={1}
        >
          {friend.username}
        </Text>
        {friend.favoriteQuote ? (
          <Text
            className="text-xs text-gray-400 dark:text-slate-500 mt-0.5"
            numberOfLines={1}
          >
            {friend.favoriteQuote}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 dark:bg-red-950 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={`${friend.username}をフレンドから削除`}
      >
        <Text className="text-xs text-red-500 dark:text-red-400">削除</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24 },
});
