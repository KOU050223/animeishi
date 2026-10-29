import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import { useFocusEffect } from "expo-router";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useFriendWatchStories } from "@/lib/useFriendWatchStories";
import type { FriendWatchStory } from "@/lib/useFriendWatchStories";
import {
  isFriendUnread,
  loadStorySeenMap,
  markStorySeen,
} from "@/lib/friendStorySeen";
import type { StorySeenMap } from "@/lib/friendStorySeen";
import { useThemeColors } from "@/lib/theme";
import { FriendStoryViewer } from "@/components/FriendStoryViewer";

// 直近 24 時間に視聴記録をつけたフレンドの丸アイコンを横並びに出す
// （issue #266）。タップで全画面ビューアを開く。既読かどうかは枠の色で
// 区別し、既読状態は端末ローカル（AsyncStorage）に持つ。
export function FriendStoryRail() {
  const { userId } = useAuth();
  const { data, refetch } = useFriendWatchStories();
  const [seenMap, setSeenMap] = useState<StorySeenMap>({});
  const [viewing, setViewing] = useState<FriendWatchStory | null>(null);
  // 初回フォーカスは useQuery の初回取得と重複するため再取得を飛ばす
  const hasFocused = useRef(false);

  // タブ切替では画面のマウントが維持され stale のまま残るため、
  // ホームへ戻ったタイミングで再取得して新着を拾う
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) void refetch();
      hasFocused.current = true;
    }, [refetch]),
  );

  useEffect(() => {
    if (!userId) return;
    void loadStorySeenMap(userId).then(setSeenMap);
  }, [userId]);

  const friends = data?.friends ?? [];
  if (friends.length === 0) return null;

  const openFriend = (friend: FriendWatchStory) => {
    setViewing(friend);
    // ビューアを開いた時点で、そのフレンドの最新活動までを既読にする
    if (!userId) return;
    const latestId = Math.max(...friend.items.map((item) => item.id));
    void markStorySeen(userId, friend.actor.userId, latestId).then(setSeenMap);
  };

  return (
    <View className="mt-3" testID="friend-story-rail">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 px-1"
      >
        {friends.map((friend) => (
          <StoryRing
            key={friend.actor.userId}
            friend={friend}
            unread={isFriendUnread(friend, seenMap)}
            onPress={() => openFriend(friend)}
          />
        ))}
      </ScrollView>
      {viewing && (
        <FriendStoryViewer friend={viewing} onClose={() => setViewing(null)} />
      )}
    </View>
  );
}

function StoryRing({
  friend,
  unread,
  onPress,
}: {
  friend: FriendWatchStory;
  unread: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className="w-16 items-center"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${friend.actor.username}の視聴ストーリー`}
      testID={`story-ring-${unread ? "unread" : "read"}-${friend.actor.userId}`}
    >
      <View
        style={[
          styles.ring,
          { borderColor: unread ? colors.primary : colors.textFaint },
        ]}
      >
        {friend.actor.profileImageUrl ? (
          <Image
            source={{ uri: friend.actor.profileImageUrl }}
            style={styles.avatar}
            className="bg-gray-200 dark:bg-slate-700"
            resizeMode="cover"
          />
        ) : (
          <View
            style={styles.avatar}
            className="items-center justify-center bg-indigo-100 dark:bg-indigo-900"
          >
            <Text className="font-semibold text-indigo-500 dark:text-indigo-300">
              {friend.actor.username.charAt(0)}
            </Text>
          </View>
        )}
      </View>
      <Text
        className="mt-1 text-xs text-gray-600 dark:text-slate-400"
        numberOfLines={1}
      >
        {friend.actor.username}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
});
