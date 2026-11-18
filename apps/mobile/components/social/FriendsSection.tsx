import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFriends, useRemoveFriend } from "@/lib/useFriends";
import type { FriendItem } from "@/lib/useFriends";
import { useFriendRequests } from "@/lib/useFriendRequests";
import type { FriendRequestItem } from "@/lib/useFriendRequests";
import { alert, confirm } from "@/lib/dialog";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";

// QR・フレンドタブの「フレンド」セクション（旧フレンドタブ）。
// 画面上部の safe area とセクション切り替えはタブ画面側が持つため、
// ここではセクション名の見出しを出さず人数だけを表示する。
export function FriendsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data: friends, isLoading, isError, refetch } = useFriends();
  // 届いたフレンド申請（issue #417）。承認・削除は相手のプロフィールで行うため、
  // ここでは通知とプロフィールへの導線だけを出す。
  const { data: friendRequests, refetch: refetchRequests } =
    useFriendRequests();
  const received = friendRequests?.received ?? [];
  const remove = useRemoveFriend();

  function onRefresh() {
    setRefreshing(true);
    // refetch が失敗してもインジケータは必ず戻す。React Compiler が
    // try/finally 構文を扱えないため Promise の .finally() で戻す（React Doctor 指摘）。
    void Promise.allSettled([refetch(), refetchRequests()]).finally(() => {
      setRefreshing(false);
    });
  }

  function confirmRemove(friendId: string, name: string) {
    confirm(
      t("フレンドを削除"),
      t("{{username}} をフレンドから削除しますか？", { username: name }),
      () => {
        // 削除失敗は画面に変化が残らないため、ダイアログで必ず伝える。
        // 呼び出し別コールバックは連続 mutate で前の呼び出し分が発火しない
        // ため、mutateAsync の promise で失敗を個別に拾う。
        void remove
          .mutateAsync(friendId)
          .catch(() =>
            alert(
              t("フレンドを削除できませんでした"),
              t("フレンドの削除に失敗しました"),
              { okLabel: "OK" },
            ),
          );
      },
      {
        confirmLabel: t("削除"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-white dark:bg-slate-900">
        <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />
      </View>
    );
  }

  if (isError && !friends) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          {t("フレンド一覧の取得に失敗しました")}
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={() => refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("フレンド一覧を再取得")}
        >
          <Text className="text-white font-semibold">{t("再試行")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const list = friends ?? [];

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      <View className="px-4 pt-1 pb-3">
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("{{count}} 人のフレンド", { count: list.length })}
        </Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.friendId}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={
          received.length > 0 ? (
            <View className="mb-4">
              <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {t("届いたフレンド申請")}
              </Text>
              {received.map((request, index) => (
                <View key={request.id}>
                  {index > 0 ? (
                    <View
                      style={styles.separator}
                      className="bg-slate-100 dark:bg-slate-800"
                    />
                  ) : null}
                  <FriendRequestRow
                    request={request}
                    onPress={() =>
                      router.push({
                        pathname: "/user/[uid]",
                        params: { uid: request.userId },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          ) : undefined
        }
        ItemSeparatorComponent={() => (
          <View
            style={styles.separator}
            className="bg-slate-100 dark:bg-slate-800"
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
            <Text className="text-slate-400 dark:text-slate-500 text-center">
              {t(
                "フレンドがいません。QR コードをスキャンして追加してください。",
              )}
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
  const { t } = useTranslation();
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
          className="bg-slate-200 dark:bg-slate-700"
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
          className="text-slate-900 dark:text-slate-100 font-medium"
          numberOfLines={1}
        >
          {friend.username}
        </Text>
        {friend.favoriteQuote ? (
          <Text
            className="text-xs text-slate-400 dark:text-slate-500 mt-0.5"
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
        accessibilityLabel={t("{{username}}をフレンドから削除", {
          username: friend.username,
        })}
      >
        <Text className="text-xs text-red-500 dark:text-red-400">
          {t("削除")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// 届いた申請の 1 行。タップで相手のプロフィールへ進み、承認・削除は
// そこで行う（issue #417 の仕様）。
function FriendRequestRow({
  request,
  onPress,
}: {
  request: FriendRequestItem;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("{{username}}からのフレンド申請", {
        username: request.username,
      })}
      testID={`friend-request-item-${request.userId}`}
    >
      {request.profileImageUrl ? (
        <Image
          source={{ uri: request.profileImageUrl }}
          style={styles.avatar}
          className="bg-slate-200 dark:bg-slate-700"
          resizeMode="cover"
        />
      ) : (
        <View
          style={styles.avatarPlaceholder}
          className="bg-indigo-100 dark:bg-indigo-900 items-center justify-center"
        >
          <Text className="text-indigo-500 dark:text-indigo-300 font-semibold">
            {request.username.charAt(0)}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text
          className="text-slate-900 dark:text-slate-100 font-medium"
          numberOfLines={1}
        >
          {request.username}
        </Text>
        <Text className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">
          {t("フレンド申請が届いています")}
        </Text>
      </View>

      <Text className="text-slate-300 dark:text-slate-600 text-lg">›</Text>
    </TouchableOpacity>
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
