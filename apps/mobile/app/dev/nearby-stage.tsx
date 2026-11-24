import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TouchableOpacity, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { MeishiCard } from "@/components/MeishiCard";
import {
  NearbyExchangeStage,
  type StagePhase,
} from "@/components/social/nearby/NearbyExchangeStage";
import { useProfile } from "@/lib/useProfile";

const STEPS: { label: string; phase: StagePhase; meters: number | null }[] = [
  { label: "探索", phase: "search", meters: null },
  { label: "発見", phase: "found", meters: null },
  { label: "50cm", phase: "found", meters: 0.5 },
  { label: "20cm", phase: "found", meters: 0.2 },
  { label: "入れ替わり", phase: "swap", meters: 0.1 },
];

const progressOf = (meters: number | null) =>
  meters == null ? 0 : Math.max(0, Math.min(1, Math.log10(1 / meters)));

// 近づけて交換の演出（D 案、issue #693）を実機 2 台なしで確かめるための画面。
// EXPO_PUBLIC_NEARBY_SPIKE=true のビルドでだけ入口が出る（/dev/nearby と同じ）。
export default function NearbyStagePreviewScreen() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  const [step, setStep] = useState(0);
  const [received, setReceived] = useState(false);
  const [runId, setRunId] = useState(0);
  if (process.env.EXPO_PUBLIC_NEARBY_SPIKE !== "true") {
    return <Redirect href="/" />;
  }
  const current = STEPS[step];
  if (!current) return null;
  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen options={{ title: t("近づけて交換の演出（試作）") }} />
      <View className="flex-1">
        <NearbyExchangeStage
          key={runId}
          phase={current.phase}
          progress={current.phase === "swap" ? 1 : progressOf(current.meters)}
          received={received}
          peerName="ハル"
          onLanded={() => {}}
          myCard=<MeishiCard
            username={profile?.username}
            bio={profile?.bio}
            favoriteQuote={profile?.favoriteQuote}
            profileImageUrl={profile?.profileImageUrl}
          />
        />
      </View>
      <View className="flex-row flex-wrap justify-center gap-2 px-4 pb-4">
        {STEPS.map((s, i) => (
          <TouchableOpacity
            key={s.label}
            className={`rounded-full px-3 py-1.5 ${i === step ? "bg-indigo-600" : "bg-slate-100 dark:bg-slate-700"}`}
            onPress={() => {
              setStep(i);
              setReceived(false);
              setRunId((n) => n + 1);
            }}
            accessibilityRole="button"
            testID={`nearby-stage-step-${i}`}
          >
            <Text className={i === step ? "text-white" : "text-secondary"}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          className="rounded-full bg-emerald-700 px-3 py-1.5"
          onPress={() => setReceived(true)}
          accessibilityRole="button"
          testID="nearby-stage-receive"
        >
          <Text className="text-white">{t("相手の名刺が届いた")}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
