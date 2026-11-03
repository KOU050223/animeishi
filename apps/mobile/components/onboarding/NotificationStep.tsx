import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui";
import { requestNotificationPermission } from "@/lib/notifications";
import { useThemeColors } from "@/lib/theme";
import { OnboardingScaffold } from "./OnboardingScaffold";

/**
 * オンボーディング 5 問目（issue #412）: 通知の許可。
 * OS の権限ダイアログを出すだけで、push トークンの登録など
 * 通知基盤側の処理は行わない（issue #410 のスコープ）。
 * 「あとで」は許可せずオンボーディングを終える。
 */
export function NotificationStep({
  stepIndex,
  totalSteps,
  onDone,
  onSkip,
}: {
  stepIndex: number;
  totalSteps: number;
  /** 許可・拒否・あとで、いずれの結果でも呼ぶ終了処理。 */
  onDone: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [requesting, setRequesting] = useState(false);

  async function handleAllow() {
    if (requesting) return;
    setRequesting(true);
    try {
      await requestNotificationPermission();
    } finally {
      setRequesting(false);
      onDone();
    }
  }

  return (
    <OnboardingScaffold
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={t("通知を受け取りますか？")}
      subtitle={t(
        "名刺の交換や友だちの新しい視聴をお知らせします。設定からいつでも変更できます。",
      )}
      onSkip={onSkip}
      footer={
        <View className="gap-2">
          <Button
            label={t("通知を許可する")}
            onPress={() => {
              void handleAllow();
            }}
            loading={requesting}
            testID="onboarding-notifications-allow"
          />
          <Button
            label={t("あとで")}
            variant="secondary"
            onPress={onDone}
            testID="onboarding-notifications-later"
          />
        </View>
      }
    >
      <View className="items-center pt-10">
        <Ionicons
          name="notifications-outline"
          size={64}
          color={colors.primary}
        />
        <Text className="mt-4 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("通知の許可はあとからでも行えます。")}
        </Text>
      </View>
    </OnboardingScaffold>
  );
}
