import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionAccessibilityProps } from "@/lib/accessibility";
import { useFriends, useRemoveFriend } from "@/lib/useFriends";
import type { FriendItem } from "@/lib/useFriends";
import { useExchangeRecords } from "@/lib/useExchangeRecords";
import { useFriendThanks, useUnreadThanksCount } from "@/lib/useFriendThanks";
import { useFriendRequests } from "@/lib/useFriendRequests";
import type { FriendRequestItem } from "@/lib/useFriendRequests";
import { alert, confirm } from "@/lib/dialog";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";
import { MeishiCard } from "@/components/MeishiCard";
import { MeishiSnapshotImage } from "@/components/meishi/MeishiSnapshotImage";
import { buildProfileUrl } from "@/lib/profileUrl";

// 交換日の表示（「2026年11月1日」形式）。解釈できない値は空文字。
function formatExchangedAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

// QR・フレンドタブの「フレンド」セクション（旧フレンドタブ）。
// 名刺帳（issue #659）として、交換した相手の名刺そのものを交換日の
// 新しい順に並べる。画面上部の safe area とセクション切り替えはタブ画面側が
// 持つため、ここではセクション名の見出しを出さず人数だけを表示する。
export function FriendsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data: friends, isLoading, isError, refetch } = useFriends();
  // イベント絞り込み（issue #661）。交換記録につけたイベント名を
  // 候補にして、そのイベントで会った人だけに絞る。並び順・
  // グループ表示は変えず、リストを間引くだけにする。
  const { data: exchangeRecords, refetch: refetchRecords } =
    useExchangeRecords();
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  // 届いた・送ったフレンド申請（issue #417、#603）。承認・取消は相手の
  // プロフィールで行うため、ここでは状態表示とプロフィールへの導線だけを出す。
  const { data: friendRequests, refetch: refetchRequests } =
    useFriendRequests();
  // 届いたお礼の未読（issue #694）。未読があるときだけ上部に 1 行出し、
  // 押すと届いたお礼の一覧へ。カードには印を付けない（静かに保つ）。
  const unreadThanksCount = useUnreadThanksCount();
  const { refetch: refetchThanks } = useFriendThanks();
  const received = friendRequests?.received ?? [];
  const sent = friendRequests?.sent ?? [];
  const remove = useRemoveFriend();
  const insets = useSafeAreaInsets();

  function openProfile(userId: string) {
    router.push({ pathname: "/user/[uid]", params: { uid: userId } });
  }

  // 届いたお礼の未読はフォーカス復帰のたびに取り直す。新しいお礼が
  // 届いていても気づけるようにする（issue #694）。
  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
  useFocusEffect(
    useCallback(() => {
      void refetchThanks();
    }, [refetchThanks]),
  );

  function onRefresh() {
    setRefreshing(true);
    // refetch が失敗してもインジケータは必ず戻す。React Compiler が
    // try/finally 構文を扱えないため Promise の .finally() で戻す（React Doctor 指摘）。
    void Promise.allSettled([
      refetch(),
      refetchRequests(),
      refetchRecords(),
      refetchThanks(),
    ]).finally(() => {
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
        <Text className="text-danger text-center mb-4">
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

  // 絞り込み候補は記録に付いたイベント名（重複を除き出現順）。
  const eventNames = [
    ...new Set(
      (exchangeRecords ?? [])
        .map((r) => r.eventName)
        .filter((name): name is string => !!name),
    ),
  ];
  // 選択中のイベントが候補から消えた（対象の記録が消えた等）場合は
  // 絞り込みを無効化する。残すと候補チップ自体が消えて
  // 解除不能な空一覧になる（issue #661 レビュー指摘）。
  const effectiveFilter =
    eventFilter && eventNames.includes(eventFilter) ? eventFilter : null;
  // 選択中のイベントで会った相手の ID。フレンド解除で記録が消えると
  // この集合も自然に小さくなる。
  const filteredIds = effectiveFilter
    ? new Set(
        (exchangeRecords ?? [])
          .filter((r) => r.eventName === effectiveFilter)
          .map((r) => r.friendId),
      )
    : null;
  const visibleList = filteredIds
    ? list.filter((f) => filteredIds.has(f.friendId))
    : list;

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      <View className="px-4 pt-1 pb-3">
        {unreadThanksCount > 0 ? (
          <TouchableOpacity
            onPress={() => router.push("/thanks")}
            accessibilityRole="button"
            accessibilityLabel={t("新しいお礼が {{count}} 件", {
              count: unreadThanksCount,
            })}
            testID="unread-thanks-banner"
            className="mb-2"
          >
            <Text className="text-sm font-medium text-primary-text">
              {t("新しいお礼が {{count}} 件", { count: unreadThanksCount })}
            </Text>
          </TouchableOpacity>
        ) : null}
        <Text className="text-xs text-muted">
          {t("{{count}} 人のフレンド", { count: visibleList.length })}
        </Text>
        {eventNames.length > 0 ? (
          <View className="flex-row flex-wrap gap-2 mt-2">
            <EventFilterChip
              label={t("すべて")}
              selected={effectiveFilter === null}
              onPress={() => setEventFilter(null)}
            />
            {eventNames.map((name) => (
              <EventFilterChip
                key={name}
                label={name}
                selected={effectiveFilter === name}
                onPress={() =>
                  setEventFilter(effectiveFilter === name ? null : name)
                }
              />
            ))}
          </View>
        ) : null}
      </View>

      <FlatList
        data={visibleList}
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
                <View {...(received.length > 0 ? { className: "mt-4" } : {})}>
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
        renderItem={({ item }) => (
          <FriendCard
            friend={item}
            onPress={() => openProfile(item.friendId)}
            onRemove={() => confirmRemove(item.friendId, item.username)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-16">
            <Text className="text-muted text-center">
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

// イベント絞り込みのチップ（issue #661）。
function EventFilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      {...selectionAccessibilityProps(selected)}
      className={`rounded-full border px-3 py-1.5 ${
        selected
          ? "border-indigo-600 bg-indigo-600"
          : "border-slate-200 dark:border-slate-700"
      }`}
    >
      <Text className={`text-xs ${selected ? "text-white" : "text-secondary"}`}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// 名刺帳の 1 件（issue #659）。相手の名刺そのものを並べ、交換日と
// 交換経路（QR／申請）を小さく添える。経路導入前の既存行は source が
// null なので交換日だけを出す。カードをタップすると相手の詳細（名刺・
// 私用メモ）へ進む。
function FriendCard({
  friend,
  onPress,
  onRemove,
}: {
  friend: FriendItem;
  onPress: () => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date = formatExchangedAt(friend.createdAt, i18n.language);
  const exchangedLabel =
    friend.source === "qr"
      ? t("{{date}}にQRで交換", { date })
      : friend.source === "request"
        ? t("{{date}}に申請で交換", { date })
        : t("{{date}}に交換", { date });

  const fallbackCard = (
    <MeishiCard
      username={friend.username}
      bio={friend.bio}
      favoriteQuote={friend.favoriteQuote}
      profileImageUrl={friend.profileImageUrl}
      profileUrl={buildProfileUrl(friend.friendId)}
      profileOnly
      hideUnsetFields
    />
  );

  // 名刺を開く領域と削除ボタンは兄弟にする。TouchableOpacity の内側に
  // ボタンを重ねると iOS VoiceOver が親で一括りにして削除ボタンへ
  // 個別にフォーカスできなくなる。
  return (
    <View
      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
      testID={`friend-card-${friend.friendId}`}
    >
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("「{{name}}」の名刺を開く", {
          name: friend.username,
        })}
        testID={`friend-item-${friend.friendId}`}
      >
        {/* エディタで作った既定名刺の公開スナップショットがあればそれを出す。
            未作成・読み込み中・失敗は classic テンプレにフォールバックする
            （issue #591 第 2 段階、#593）。 */}
        <MeishiSnapshotImage
          uri={friend.meishiSnapshotUrl}
          testID={`friend-snapshot-${friend.friendId}`}
          fallback={fallbackCard}
        />
      </TouchableOpacity>
      <View className="mt-2 flex-row items-center justify-between">
        <Text
          className="text-xs text-muted"
          testID={`friend-exchanged-${friend.friendId}`}
        >
          {exchangedLabel}
        </Text>
        <TouchableOpacity
          onPress={onRemove}
          className="rounded-md px-1.5 py-1"
          accessibilityRole="button"
          accessibilityLabel={t("{{username}}をフレンドから削除", {
            username: friend.username,
          })}
          testID={`friend-remove-${friend.friendId}`}
        >
          <Text className="text-xs text-danger">{t("削除")}</Text>
        </TouchableOpacity>
      </View>
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
      <Text className="text-xs font-semibold text-muted mb-1">{label}</Text>
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
          <Text className="text-indigo-700 dark:text-indigo-300 font-semibold">
            {request.username.charAt(0)}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-foreground font-medium" numberOfLines={1}>
          {request.username}
        </Text>
        <Text className="text-xs text-primary-text mt-0.5">{statusLabel}</Text>
      </View>

      <Text className="text-muted text-lg">›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  separator: { height: 1 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24 },
});
