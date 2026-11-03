import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";

/**
 * 初回オンボーディング（issue #412）の画面骨格。
 * 「1 画面 1 問」に合わせて、上部に進捗バーと「スキップ」、
 * 質問タイトル、内容、下部の CTA を並べる。
 */
export function OnboardingScaffold({
  stepIndex,
  totalSteps,
  title,
  subtitle,
  children,
  footer,
  onSkip,
}: {
  /** 0 始まりの現在ステップ。 */
  stepIndex: number;
  totalSteps: number;
  /** この画面の質問（1 画面 1 問）。 */
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** 下部に固定する CTA 領域。 */
  footer?: ReactNode;
  /** 「スキップ」（オンボーディング全体を抜ける）。 */
  onSkip: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="px-6 pt-3">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-xs text-slate-500 dark:text-slate-400">
            {t("{{current}} / {{total}}", {
              current: stepIndex + 1,
              total: totalSteps,
            })}
          </Text>
          <TouchableOpacity
            onPress={onSkip}
            testID="onboarding-skip"
            accessibilityRole="button"
          >
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t("スキップ")}
            </Text>
          </TouchableOpacity>
        </View>
        <View className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <View
            className="h-full rounded-full bg-indigo-600"
            style={{
              width: `${((stepIndex + 1) / totalSteps) * 100}%`,
            }}
          />
        </View>
        <Text
          className="mb-1 mt-5 text-xl font-bold text-slate-900 dark:text-slate-100"
          testID="onboarding-title"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="mb-3 text-sm leading-5 text-slate-500 dark:text-slate-400">
            {subtitle}
          </Text>
        ) : (
          <View className="mb-3" />
        )}
      </View>
      <View className="flex-1 px-6">{children}</View>
      {footer ? <View className="px-6 pb-3 pt-2">{footer}</View> : null}
    </SafeAreaView>
  );
}
