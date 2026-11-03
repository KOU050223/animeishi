import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui";
import { MeishiRenderer } from "@/components/meishi/MeishiRenderer";
import { MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import { useThemeColors } from "@/lib/theme";
import { OnboardingScaffold } from "./OnboardingScaffold";

/**
 * オンボーディング 2 問目（issue #412）: 名刺のテンプレートを選ぶ。
 * 名刺エディタと同じ MEISHI_TEMPLATES をそのまま使い、
 * エディタの TemplatePicker と同じプレビュー（サンプル値）で並べる。
 */
export function TemplateStep({
  stepIndex,
  totalSteps,
  selectedTemplateId,
  onSelect,
  onNext,
  onSkip,
}: {
  stepIndex: number;
  totalSteps: number;
  selectedTemplateId: string | null;
  onSelect: (templateId: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const footer = (
    <Button
      label={t("次へ")}
      onPress={onNext}
      disabled={!selectedTemplateId}
      testID="onboarding-template-next"
    />
  );

  return (
    <OnboardingScaffold
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={t("名刺のテンプレートを選んでください")}
      subtitle={t("あとからエディタで細かく編集できます。")}
      onSkip={onSkip}
      footer={footer}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 16, gap: 12 }}>
        {MEISHI_TEMPLATES.map((tpl) => {
          const isSelected = tpl.id === selectedTemplateId;
          return (
            <Pressable
              key={tpl.id}
              onPress={() => onSelect(tpl.id)}
              style={{
                borderWidth: 2,
                borderColor: isSelected ? colors.primary : colors.border,
                borderRadius: 12,
                padding: 12,
                gap: 8,
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`onboarding-template-${tpl.id}`}
            >
              <View className="flex-row items-center gap-1.5">
                <Ionicons name={tpl.icon} size={16} color={colors.textMuted} />
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {tpl.name}
                </Text>
              </View>
              <MeishiRenderer
                document={tpl.build()}
                context={{
                  profile: {
                    username: "サンプル",
                    bio: "自己紹介テキスト",
                    favoriteQuote: "「好きなセリフ」",
                    profileUrl: "https://example.com",
                  },
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </OnboardingScaffold>
  );
}
