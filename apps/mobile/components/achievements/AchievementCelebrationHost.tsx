import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  achievementIconName,
  achievementName,
  achievementShareMessage,
  diffNewlyEarned,
  earnedAchievementKeys,
} from "@/lib/achievements/definitions";
import {
  loadSeenAchievementKeys,
  saveSeenAchievementKeys,
} from "@/lib/achievements/seenStore";
import { shareAchievementMessage } from "@/lib/achievements/share";
import { useAchievements } from "@/lib/achievements/useAchievements";
import type { Achievement } from "@/lib/achievements/types";

/**
 * 実績の新規獲得を検出してお祝いオーバーレイを出すホスト（issue #415）。
 * ルートレイアウトに 1 つだけ置く。
 *
 * サーバーは獲得履歴を持たず都度計算だけ返すため、「新しく獲得した」は
 * 端末に保存した前回確認時点の獲得キーとの差分で判定する。
 * 機能追加前から獲得済みだったバッジが初回起動でまとめて表示されないよう、
 * 保存キーが一度も無い初回はベースラインとして保存するだけにする。
 */
export function AchievementCelebrationHost() {
  const { isSignedIn, userId } = useAuth();
  const { data } = useAchievements();
  const [queue, setQueue] = useState<Achievement[]>([]);
  // 同じ獲得集合で何度も差分計算・保存しないための処理済みシグネチャ。
  const processedSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !userId || !data) return;
    const keys = earnedAchievementKeys(data).sort();
    const signature = `${userId}:${keys.join("|")}`;
    if (processedSignature.current === signature) return;
    processedSignature.current = signature;
    void (async () => {
      const seen = await loadSeenAchievementKeys(userId);
      if (seen === null) {
        await saveSeenAchievementKeys(userId, keys);
        return;
      }
      const fresh = diffNewlyEarned(data, seen);
      // 先に保存する。閉じる前にアプリが落ちても同じお祝いが
      // 繰り返し出る方が「出なかった」より害が大きいため。
      await saveSeenAchievementKeys(userId, keys);
      if (fresh.length > 0) setQueue(fresh);
    })();
  }, [isSignedIn, userId, data]);

  const current = queue[0] ?? null;
  if (!current) return null;

  return (
    <AchievementCelebrationOverlay
      achievement={current}
      onClose={() => setQueue((q) => q.slice(1))}
    />
  );
}

function AchievementCelebrationOverlay({
  achievement,
  onClose,
}: {
  achievement: Achievement;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const name = achievementName(t, achievement);
  const message = achievementShareMessage(t, achievement);

  const onShare = async () => {
    const result = await shareAchievementMessage(message);
    if (result === "copied") setCopiedFeedback(true);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View
          className="w-full max-w-sm items-center rounded-2xl bg-white p-6 dark:bg-slate-800"
          accessibilityViewIsModal
        >
          <View className="h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
            <Ionicons
              name={achievementIconName(achievement.kind)}
              size={34}
              color="#d97706"
            />
          </View>
          <Text className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-100">
            {t("実績を獲得しました！")}
          </Text>
          <Text className="mt-1 text-base font-semibold text-indigo-600 dark:text-indigo-300">
            {name}
          </Text>
          <Text
            selectable
            className="mt-3 rounded bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          >
            {message}
          </Text>
          <Pressable
            onPress={() => void onShare()}
            className="mt-4 w-full items-center rounded-lg bg-indigo-600 px-4 py-2.5"
            accessibilityRole="button"
            accessibilityLabel={t("実績をシェアする")}
          >
            <Text className="text-sm font-semibold text-white">
              {copiedFeedback ? t("コピーしました") : t("シェアする")}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            className="mt-2 items-center px-4 py-2"
            accessibilityRole="button"
            accessibilityLabel={t("閉じる")}
          >
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t("閉じる")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
