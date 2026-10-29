import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAnalysis, useGenerateAnalysis } from "@/lib/useAnalysis";
import { ApiRequestError } from "@/lib/apiError";
import { trackEvent } from "@/lib/events";
import { TRACK_EVENT_KEYS } from "@animeishi/observability";
import { useThemeColors } from "@/lib/theme";
import { BackButton } from "@/components/ui";

// generatedAt（ISO 8601）の表示用。Hermes の Intl 実装差を避けるため
// toLocaleString ではなく手動で整形する。
function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// AI 視聴傾向分析（issue #22）。プロフィール画面から遷移する非タブ画面。
// - GET /me/analysis で保存済み結果を表示
// - 「分析する / 再分析する」で POST /me/analysis（API 側で 24h キャッシュ・
//   ユーザーあたりの生成回数制限あり）
export default function AnalysisScreen() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useAnalysis();
  const generate = useGenerateAnalysis();

  const analysis = data?.analysis ?? null;

  // changelog と同じ規約。直リンクでは遷移履歴が無いためホームへ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  // 「分析する / 再分析する」の押下を計測する（issue #214）。
  // 結果があるかで初回・再実行を分ける。
  const onGenerate = (runType: "initial" | "regenerate") => {
    trackEvent("analysis_generate", { [TRACK_EVENT_KEYS.runType]: runType });
    generate.mutate();
  };

  const generateErrorMessage =
    generate.error instanceof ApiRequestError
      ? generate.error.message
      : generate.isError
        ? t("分析に失敗しました。時間をおいて再度お試しください")
        : null;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top", "bottom"]}
      >
        <BackButton
          onPress={handleBack}
          className="ml-2 self-start"
          accessibilityLabel={t("戻る")}
          testID="analysis-back-button"
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-red-500 dark:text-red-400">
            {t("分析結果の取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("分析結果を再取得")}
          >
            <Text className="font-semibold text-white">
              {t("もう一度試す")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <ScrollView contentContainerClassName="px-4 pb-12">
        <BackButton
          onPress={handleBack}
          className="-ml-2 self-start"
          accessibilityLabel={t("戻る")}
          testID="analysis-back-button"
        />
        <View className="pb-3">
          <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("AI 視聴傾向分析")}
          </Text>
          <Text className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            {t(
              "あなたの視聴履歴をもとに、AI が視聴傾向とおすすめジャンルを分析します",
            )}
          </Text>
        </View>

        {analysis === null ? (
          <View className="items-center justify-center py-16">
            <Text className="mb-6 text-center text-gray-400 dark:text-slate-500">
              {t("まだ分析結果がありません")}
            </Text>
            <GenerateButton
              label={t("分析する")}
              pendingLabel={t("分析中...")}
              isPending={generate.isPending}
              onPress={() => onGenerate("initial")}
              colors={colors}
            />
          </View>
        ) : (
          <View>
            <View className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
                {t("視聴傾向")}
              </Text>
              <Text className="text-base leading-6 text-gray-900 dark:text-slate-100">
                {analysis.summary}
              </Text>

              {analysis.recommendedGenres.length > 0 ? (
                <View className="mt-4">
                  <Text className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
                    {t("おすすめジャンル")}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {analysis.recommendedGenres.map((genre) => (
                      <View
                        key={genre}
                        className="bg-purple-100 dark:bg-purple-900 rounded-full px-3 py-1"
                      >
                        <Text className="text-purple-700 dark:text-purple-300 text-sm">
                          {genre}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            <Text className="mt-3 text-xs text-gray-400 dark:text-slate-500">
              {t("{{count}} 件の視聴履歴を分析", { count: analysis.workCount })}
            </Text>
            <Text className="text-xs text-gray-400 dark:text-slate-500">
              {t("分析日時: {{date}}", {
                date: formatGeneratedAt(analysis.generatedAt),
              })}
            </Text>

            <View className="mt-4">
              <GenerateButton
                label={t("再分析する")}
                pendingLabel={t("分析中...")}
                isPending={generate.isPending}
                onPress={() => onGenerate("regenerate")}
                colors={colors}
              />
              <Text className="mt-2 text-xs text-gray-400 dark:text-slate-500">
                {t(
                  "視聴履歴が変わると次回の実行で結果が更新されます（1 日あたりの実行回数に上限があります）",
                )}
              </Text>
            </View>
          </View>
        )}

        {generateErrorMessage ? (
          <View className="mt-4 rounded-lg bg-red-50 dark:bg-red-950 px-4 py-3">
            <Text
              className="text-sm text-red-600 dark:text-red-400"
              accessibilityRole="alert"
            >
              {generateErrorMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function GenerateButton({
  label,
  pendingLabel,
  isPending,
  onPress,
  colors,
}: {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <TouchableOpacity
      className="items-center rounded-lg bg-indigo-600 px-6 py-3"
      onPress={onPress}
      disabled={isPending}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {isPending ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={colors.onPrimary} />
          <Text className="font-semibold text-white">{pendingLabel}</Text>
        </View>
      ) : (
        <Text className="font-semibold text-white">{label}</Text>
      )}
    </TouchableOpacity>
  );
}
