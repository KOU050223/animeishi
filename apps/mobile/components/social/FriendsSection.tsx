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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  // 届いた・送ったフレンド申請（issue #417、#603）。承認・取消は相手の
  // プロフィールで行うため、ここでは状態表示とプロフィールへの導線だけを出す。
  const { data: friendRequests, refetch: refetchRequests } =
    useFriendRequests();
  const received = friendRequests?.received ?? [];
  const sent = friendRequests?.sent ?? [];
  const remove = useRemoveFriend();
  const insets = useSafeAreaInsets();

  function openProfile(userId: string) {
    router.push({ pathname: "/user/[uid]", params: { uid: userId } });
  }

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
        // 下端はネイティブのタブバーに潜り込むため、最後の行がその下に
        // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 32 + insets.bottom },
        ]}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={
          received.length > 0 || sent.length > 0 ? (
            <View className="mb-4">
              {received.length > 0 ? (
                <FriendRequestGroup
                  label={t("届いたフレンド申請")}
                  requests={received}
                  statusLabel={t("フレンド申請が届いています")}
                  makeAccessibilityLabel={(request) =>
                    t("{{username}}からのフレンド申請", {
                      username: request.username,
                    })
                  }
                  testIDPrefix="friend-request-item"
                  onPress={openProfile}
                />
              ) : null}
              {sent.length > 0 ? (
                <View className={received.length > 0 ? "mt-4" : undefined}>
                  <FriendRequestGroup
                    label={t("送ったフレンド申請")}
                    requests={sent}
                    statusLabel={t("フレンド申請中")}
                    makeAccessibilityLabel={(request) =>
                      t("{{username}}へのフレンド申請", {
                        username: request.username,
                      })
                    }
                    testIDPrefix="sent-friend-request-item"
                    onPress={openProfile}
                  />
                </View>
              ) : null}
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
            onPress={() => openProfile(item.friendId)}
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
  onPress,
  onRemove,
}: {
  friend: FriendItem;
  onPress: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  // プロフィールを開く領域と削除ボタンは兄弟にする。TouchableOpacity の
  // 内側にボタンを重ねると iOS VoiceOver が親で一括りにして
  // 削除ボタンへ個別にフォーカスできなくなる。
  return (
    <View className="flex-row items-center py-3 gap-3">
      <TouchableOpacity
        className="flex-1 flex-row items-center gap-3"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("{{username}}のプロフィールを見る", {
          username: friend.username,
        })}
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
      </TouchableOpacity>

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

// 申請の 1 グループ（届いた・送った）。見出し + 行リスト。
function FriendRequestGroup({
  label,
  requests,
  statusLabel,
  makeAccessibilityLabel,
  testIDPrefix,
  onPress,
}: {
  label: string;
  requests: FriendRequestItem[];
  statusLabel: string;
  makeAccessibilityLabel: (request: FriendRequestItem) => string;
  testIDPrefix: string;
  onPress: (userId: string) => void;
}) {
  return (
    <View>
      <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </Text>
      {requests.map((request, index) => (
        <View key={request.id}>
          {index > 0 ? (
            <View
              style={styles.separator}
              className="bg-slate-100 dark:bg-slate-800"
            />
          ) : null}
          <FriendRequestRow
            request={request}
            statusLabel={statusLabel}
            accessibilityLabel={makeAccessibilityLabel(request)}
            testID={`${testIDPrefix}-${request.userId}`}
            onPress={() => onPress(request.userId)}
          />
        </View>
      ))}
    </View>
  );
}

// 申請の 1 行。タップで相手のプロフィールへ進み、承認・取消は
// そこで行う（issue #417 の仕様）。
function FriendRequestRow({
  request,
  statusLabel,
  accessibilityLabel,
  testID,
  onPress,
}: {
  request: FriendRequestItem;
  statusLabel: string;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 gap-3"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
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
          {statusLabel}
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
