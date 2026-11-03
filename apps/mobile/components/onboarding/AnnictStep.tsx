import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { useAnnictConnection } from "@/lib/annict";
import { OnboardingScaffold } from "./OnboardingScaffold";

/**
 * オンボーディング 4 問目（issue #412）: Annict 連携。
 * 連携 UI・ファネル計測は既存の AnnictConnectionCard に任せ、
 * surface は「onboarding」で分離する（issue #424 の作法）。
 * フッターは「あとで」（連携せず先へ進む）。連携できた状態では
 * ラベルを「次へ」に変える。
 */
export function AnnictStep({
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
}: {
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const { isConnected } = useAnnictConnection();
  const footer = (
    <Button
      label={isConnected ? t("次へ") : t("あとで")}
      variant={isConnected ? "primary" : "secondary"}
      onPress={onNext}
      testID="onboarding-annict-later"
    />
  );

  return (
    <OnboardingScaffold
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={t("Annict と連携しますか？")}
      onSkip={onSkip}
      footer={footer}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <AnnictConnectionCard surface="onboarding" />
      </ScrollView>
    </OnboardingScaffold>
  );
}
