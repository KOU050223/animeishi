import { useCallback, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  MEISHI_COMPLETION_STEPS,
  MEISHI_COMPLETION_STEP_LABELS,
} from "@/lib/meishi/completion";
import type { MeishiCompletionStep } from "@/lib/meishi/completion";
import { useMeishiCompletion } from "@/lib/meishi/useMeishiCompletion";
import type { TranslationKey } from "@/lib/i18n/keys";
import { useThemeColors } from "@/lib/theme";

// 未達項目のタップ先。アイコン・表示名はプロフィール編集（プロフタブ）、
// 推しはライブラリタブの推しセクション、テンプレートは名刺エディタ
// （ドキュメントが無い既定カードでは起動時にテンプレートピッカーが開く）。
const STEP_DESTINATIONS: Record<MeishiCompletionStep, Href> = {
  avatar: "/(tabs)/profile",
  displayName: "/(tabs)/profile",
  favorites: "/(tabs)/library?section=favorites",
  template: "/meishi/edit",
};

const STEP_ACTION_LABELS: Record<MeishiCompletionStep, TranslationKey> = {
  avatar: "アイコンを設定する",
  displayName: "表示名を設定する",
  favorites: "推し作品を登録する",
  template: "テンプレートを選ぶ",
};

/**
 * ホームの名刺完成度カード（issue #419）。オンボーディング（#412）を
 * 途中で抜けた人の受け皿として、完成の定義（アイコン・表示名・
 * 推し 3 作・テンプレート選択）に足りない項目を列挙し、
 * タップで該当画面へ誘導する。4 点すべて満たしたら出さない。
 */
export function MeishiCompletionCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const { missing, isComplete, isLoading, reload } = useMeishiCompletion();

  // タブ切替では画面のマウントが維持されるため、名刺編集や推し登録から
  // 戻ったタイミングで AsyncStorage のドキュメントを読み直す
  // （初回フォーカスはフック内の初回ロードと重複するので飛ばす。
  // プロフィール・推しは react-query のキャッシュ更新で追随する）。
  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) void reload();
      hasFocused.current = true;
    }, [reload]),
  );

  if (isLoading || isComplete) return null;

  return (
    <View
      className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
      testID="meishi-completion-card"
    >
      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {t("名刺を完成させよう（残り {{count}} ステップ）", {
          count: missing.length,
        })}
      </Text>
      {MEISHI_COMPLETION_STEPS.map((step) => {
        const done = !missing.includes(step);
        if (done) {
          return (
            <View key={step} className="flex-row items-center py-1.5">
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={colors.success}
              />
              <Text className="ml-2 text-sm text-slate-400 dark:text-slate-500">
                {t(MEISHI_COMPLETION_STEP_LABELS[step])}
              </Text>
            </View>
          );
        }
        return (
          <Pressable
            key={step}
            className="flex-row items-center py-1.5"
            onPress={() => router.push(STEP_DESTINATIONS[step])}
            accessibilityRole="button"
            accessibilityLabel={t(STEP_ACTION_LABELS[step])}
            testID={`meishi-completion-step-${step}`}
          >
            <Ionicons
              name="ellipse-outline"
              size={18}
              color={colors.primaryText}
            />
            <Text className="ml-2 flex-1 text-sm font-medium text-indigo-700 dark:text-indigo-300">
              {t(MEISHI_COMPLETION_STEP_LABELS[step])}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.primaryText}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
