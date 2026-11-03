import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { BackButton } from "@/components/ui";
import {
  achievementDescription,
  achievementIconName,
  achievementName,
} from "@/lib/achievements/definitions";
import { useAchievements } from "@/lib/achievements/useAchievements";
import type { Achievement, AchievementKind } from "@/lib/achievements/types";
import { useThemeColors } from "@/lib/theme";
import type { TFunction } from "i18next";

const KIND_ORDER: AchievementKind[] = [
  "watch_count",
  "record_streak",
  "season_completion",
];

function kindSectionTitle(t: TFunction, kind: AchievementKind) {
  switch (kind) {
    case "watch_count":
      return t("視聴数");
    case "record_streak":
      return t("連続記録");
    case "season_completion":
      return t("今期完走");
  }
}

// 実績（バッジ）一覧（issue #415）。獲得済みは通常表示、未獲得はグレー表示、
// 進捗は n/N で示す。プロフィール画面から遷移する非タブ画面。
export default function AchievementsScreen() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useAchievements();

  // changelog / analysis と同じ規約。直リンクでは遷移履歴が無いためホームへ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const items = data?.achievements ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <Stack.Screen
        options={{
          title: t("実績"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton onPress={handleBack} accessibilityLabel={t("戻る")} />
          ),
        }}
      />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-red-500 dark:text-red-400">
            {t("実績の取得に失敗しました")}
          </Text>
          <TouchableOpacity
            className="rounded-lg bg-indigo-600 px-6 py-3"
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel={t("実績を再取得")}
          >
            <Text className="font-semibold text-white">{t("再試行")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerClassName="pb-12">
          <Text className="mx-4 mb-2 mt-4 text-xs text-slate-500 dark:text-slate-400">
            {t(
              "記録を続けるとバッジが増えます。獲得したバッジは名刺に置けます。",
            )}
          </Text>
          {KIND_ORDER.map((kind) => {
            const section = items.filter((a) => a.kind === kind);
            if (section.length === 0) return null;
            return (
              <View key={kind} className="mt-4">
                <Text className="mx-4 mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {kindSectionTitle(t, kind)}
                </Text>
                <View className="mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  {section.map((a, i) => (
                    <AchievementRow
                      key={a.id}
                      achievement={a}
                      isLast={i === section.length - 1}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function AchievementRow({
  achievement,
  isLast,
}: {
  achievement: Achievement;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const name = achievementName(t, achievement);

  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3${
        isLast ? "" : " border-b border-slate-100 dark:border-slate-800"
      }`}
      accessible
      accessibilityLabel={[
        name,
        achievement.earned ? t("獲得済み") : t("未獲得"),
        achievement.progress.target != null
          ? `${achievement.progress.current}/${achievement.progress.target}`
          : null,
      ]
        .filter(Boolean)
        .join("、")}
    >
      <View
        className={`h-11 w-11 items-center justify-center rounded-full ${
          achievement.earned
            ? "bg-amber-100 dark:bg-amber-900"
            : "bg-slate-100 dark:bg-slate-800"
        }`}
      >
        <Ionicons
          name={achievementIconName(achievement.kind)}
          size={22}
          color={achievement.earned ? "#d97706" : "#94a3b8"}
        />
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm font-semibold ${
            achievement.earned
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {name}
        </Text>
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {achievementDescription(t, achievement.kind)}
        </Text>
        {achievement.work ? (
          <Text
            className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"
            numberOfLines={1}
          >
            {achievement.work.title}
          </Text>
        ) : null}
        {!achievement.available ? (
          <Text className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
            {t("Annict と連携すると判定できます")}
          </Text>
        ) : null}
      </View>
      {achievement.progress.target != null ? (
        <Text
          className={`text-sm font-semibold ${
            achievement.earned
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {achievement.progress.current}/{achievement.progress.target}
        </Text>
      ) : achievement.earned ? (
        <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
      ) : null}
    </View>
  );
}
