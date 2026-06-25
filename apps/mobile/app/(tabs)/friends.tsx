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
import { useFriends, useRemoveFriend } from "@/lib/useFriends";
import type { FriendItem } from "@/lib/useFriends";
import { confirm } from "@/lib/dialog";

export default function FriendsScreen() {
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
      () => remove.mutate(friendId),
      { confirmLabel: "削除", cancelLabel: "キャンセル", destructive: true },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-red-500 text-center mb-4">
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
    <View className="flex-1 bg-white">
      <View className="px-4 pt-12 pb-3">
        <Text className="text-xl font-bold text-gray-900">フレンド</Text>
        <Text className="text-xs text-gray-400 mt-0.5">{list.length} 人</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.friendId}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => (
          <View style={styles.separator} className="bg-gray-100" />
        )}
        renderItem={({ item }) => (
          <FriendRow
            friend={item}
            onRemove={() => confirmRemove(item.friendId, item.username)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-gray-400 text-center">
              フレンドがいません。{"\n"}QR
              コードをスキャンして追加してください。
            </Text>
          </View>
        }
      />
    </View>
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
          resizeMode="cover"
        />
      ) : (
        <View
          style={styles.avatarPlaceholder}
          className="bg-indigo-100 items-center justify-center"
        >
          <Text className="text-indigo-500 font-semibold">
            {friend.username.charAt(0)}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-gray-900 font-medium" numberOfLines={1}>
          {friend.username}
        </Text>
        {friend.favoriteQuote ? (
          <Text className="text-xs text-gray-400 mt-0.5" numberOfLines={1}>
            {friend.favoriteQuote}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onRemove}
        className="bg-red-50 rounded-lg px-3 py-1.5"
        accessibilityRole="button"
        accessibilityLabel={`${friend.username}をフレンドから削除`}
      >
        <Text className="text-xs text-red-500">削除</Text>
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
    backgroundColor: "#e5e7eb",
  },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24 },
});
