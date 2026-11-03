import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui";
import { MeishiCard } from "@/components/MeishiCard";
import { useMeishiCompletion } from "@/lib/meishi/useMeishiCompletion";
import type { MeishiCompletionStep } from "@/lib/meishi/completion";
import type { TranslationKey } from "@/lib/i18n/keys";
import type { MeishiDocument } from "@/lib/meishi/types";
import { useProfile } from "@/lib/useProfile";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useThemeColors } from "@/lib/theme";
import { OnboardingScaffold } from "./OnboardingScaffold";

const STEP_LABELS: Record<MeishiCompletionStep, TranslationKey> = {
  avatar: "アイコン",
  displayName: "表示名",
  favorites: "推し作品 3 件",
  template: "テンプレート",
};

/**
 * オンボーディング 3 問目（issue #412）: 完成した名刺のプレビュー。
 * 選んだテンプレート + 推しコラージュ（buildOnboardingDocument）を実データで
 * 描画し、名刺の完成度（issue #419 と共通の判定）をチェックリストで見せる。
 */
export function CompletionStep({
  stepIndex,
  totalSteps,
  document,
  onNext,
  onSkip,
}: {
  stepIndex: number;
  totalSteps: number;
  /** テンプレート選択時に保存した名刺ドキュメント。 */
  document: MeishiDocument;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { data: profile } = useProfile();
  const { missing, isComplete } = useMeishiCompletion();

  const allSteps: MeishiCompletionStep[] = [
    "avatar",
    "displayName",
    "favorites",
    "template",
  ];
  const footer = (
    <Button label={t("次へ")} onPress={onNext} testID="onboarding-done-next" />
  );

  return (
    <OnboardingScaffold
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={t("名刺ができました")}
      subtitle={t("この名刺を見せて、友だちと交換できます。")}
      onSkip={onSkip}
      footer={footer}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <MeishiCard
          document={document}
          username={profile?.username}
          bio={profile?.bio}
          favoriteQuote={profile?.favoriteQuote}
          profileImageUrl={profile?.profileImageUrl}
          profileUrl={profile?.id ? buildProfileUrl(profile.id) : undefined}
        />
        <View className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <Text className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isComplete
              ? t("名刺は完成しています")
              : t("名刺の完成まであと少し")}
          </Text>
          {allSteps.map((step) => {
            const done = !missing.includes(step);
            return (
              <View key={step} className="flex-row items-center py-1">
                <Ionicons
                  name={done ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={done ? colors.success : colors.textFaint}
                />
                <Text className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                  {t(STEP_LABELS[step])}
                </Text>
              </View>
            );
          })}
          {!isComplete ? (
            <Text className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t("アイコンや表示名はプロフィールからいつでも設定できます。")}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </OnboardingScaffold>
  );
}
