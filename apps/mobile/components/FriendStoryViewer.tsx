import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import type { FriendWatchStory } from "@/lib/useFriendWatchStories";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";
import { formatRelativeTime } from "@/lib/activityText";

// 1 スライドの表示時間。Instagram のストーリー（写真 5 秒）に合わせる。
const SLIDE_DURATION_MS = 5000;

// 視聴活動（watch_status）を全画面スライドで見せるビューア（issue #266）。
// 右側タップ・時間経過で次へ、左側タップで前へ。最後まで見るか閉じると
// onClose が呼ばれる。既読化は開く側（FriendStoryRail）が担う。
export function FriendStoryViewer({
  friend,
  onClose,
}: {
  friend: FriendWatchStory;
  onClose: () => void;
}) {
  const items = friend.items;
  const [index, setIndex] = useState(0);
  const [progress] = useState(() => new Animated.Value(0));
  const item = items[index];

  const goNext = useCallback(() => {
    // 最後のスライドで「次へ」はビューアを閉じる
    if (index + 1 >= items.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }, [index, items.length, onClose]);

  const goPrev = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  // スライドごとの自動送りタイマー。プログレスバーの塗りつぶしと
  // 送りタイミングを同じ Animated で駆動する。
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_DURATION_MS,
      // width 割合の補間はレイアウトアニメーションなので JS 駆動
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) goNext();
    });
    return () => animation.stop();
    // goNext は index 依存で再生成されるため、スライド送りごとに
    // タイマーとプログレスバーがリセットされる
  }, [progress, goNext]);

  if (!item) return null;

  const state = item.meta?.state;
  const statusLabel =
    typeof state === "string" && state in WATCH_STATUS_LABELS
      ? WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS]
      : "視聴";

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      testID="friend-story-viewer"
    >
      <View className="flex-1 bg-black">
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          {/* 進行バー */}
          <View className="flex-row gap-1 px-3 pt-2">
            {items.map((storyItem, i) => (
              <View
                key={storyItem.id}
                className="h-0.5 flex-1 overflow-hidden rounded bg-white/30"
              >
                {i < index ? (
                  <View className="h-full w-full bg-white" />
                ) : i === index ? (
                  <Animated.View
                    style={[
                      styles.progressFill,
                      {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                ) : null}
              </View>
            ))}
          </View>

          {/* ヘッダー（タップ領域より手前に置き、閉じるボタンを優先する） */}
          <View className="z-10 mt-2 flex-row items-center gap-2 px-3">
            {friend.actor.profileImageUrl ? (
              <Image
                source={{ uri: friend.actor.profileImageUrl }}
                style={styles.headerAvatar}
                className="bg-slate-700"
                resizeMode="cover"
              />
            ) : (
              <View
                style={styles.headerAvatar}
                className="items-center justify-center bg-indigo-900"
              >
                <Text className="text-sm font-semibold text-indigo-300">
                  {friend.actor.username.charAt(0)}
                </Text>
              </View>
            )}
            <Text className="flex-1 text-sm font-semibold text-white">
              {friend.actor.username}
              <Text className="font-normal text-white/60">
                {"  "}
                {formatRelativeTime(item.createdAt)}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              testID="story-close"
              className="px-2 py-1"
            >
              <Text className="text-2xl leading-6 text-white">×</Text>
            </TouchableOpacity>
          </View>

          {/* スライド本体 + タップ領域 */}
          <View className="flex-1">
            <View className="flex-1 items-center justify-center gap-4 px-8">
              {item.work?.hostedImageUrl ? (
                <Image
                  source={{ uri: item.work.hostedImageUrl }}
                  style={styles.workImage}
                  className="bg-slate-800"
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={styles.workImage}
                  className="items-center justify-center bg-slate-800"
                />
              )}
              <Text
                className="text-center text-xl font-bold text-white"
                testID="story-work-title"
              >
                {item.work?.title ?? "作品"}
              </Text>
              <Text className="text-center text-base text-white/80">
                {statusLabel}にしました
              </Text>
            </View>

            {/* タップ領域: 左 = 前へ、右 = 次へ */}
            <View style={StyleSheet.absoluteFill} className="flex-row">
              <Pressable
                className="h-full"
                style={styles.prevZone}
                onPress={goPrev}
                accessibilityRole="button"
                accessibilityLabel="前のストーリー"
                testID="story-prev"
              />
              <Pressable
                className="h-full flex-1"
                onPress={goNext}
                accessibilityRole="button"
                accessibilityLabel="次のストーリー"
                testID="story-next"
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // react-native-css の styled() は style prop のオブジェクトを深く再帰
  // コピーするため、Animated の補間値を含む style とは併用できない。
  // このビューは className ではなく StyleSheet で固定部分を定義する。
  progressFill: {
    height: "100%",
    backgroundColor: "#fff",
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  workImage: {
    width: "70%",
    aspectRatio: 3 / 4,
    borderRadius: 16,
  },
  prevZone: {
    width: "30%",
  },
});
