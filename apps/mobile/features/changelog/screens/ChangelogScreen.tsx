import { useTranslation } from "react-i18next";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useRouter } from "expo-router";
import { BackButton } from "@/components/ui";
import {
  FEATURES,
  PLANNED_FEATURES,
  UPDATES,
  type PlannedFeature,
} from "@/features/changelog/changelog";

const ISSUES_URL = "https://github.com/KOU050223/animeishi/issues";

// Intl.DateTimeFormat の生成は重いため言語ごとにキャッシュする。
// コンポーネント内で毎回 new すると react-doctor の js-hoist-intl に
// 引っかかるうえ、言語切替のたびに作り直すのも無駄。
const updateDateFormatters = new Map<string, Intl.DateTimeFormat>();

// UPDATES の date は「2026年11月19日」形式固定のため、日本語以外では
// ロケール書式に変換して出す（本文自体は日本語正本で i18n 対象外）。
function formatLatestUpdateDate(language: string): string {
  const latest = UPDATES[0];
  if (!latest) return "";
  const match = latest.date.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (!match || language.startsWith("ja")) return latest.date;
  let formatter = updateDateFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    updateDateFormatters.set(language, formatter);
  }
  return formatter.format(
    new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

// アプリの機能一覧・更新情報・今後の予定をまとめた静的ページ（issue #98）。
// 表示内容は features/changelog/changelog.ts の静的データがソースオブトゥルース。
// 更新履歴・機能一覧の本文（features/changelog/changelog.ts）はリリースノートとして日本語を
// 正本とし i18n 対象外。ページの枠（タイトル・見出し・案内）だけは t() 化する。
export function ChangelogScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const lastUpdated = formatLatestUpdateDate(i18n.language);

  // LegalDocument / meishi/edit と同じ規約。直リンクでは遷移履歴が無いため、
  // ホーム（認証状態に応じて AuthGuard が振り分ける）へ戻す。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {/* 戻るボタンはネイティブヘッダー側（issue #395 Phase 2）。
          headerLeft を自前で出すのは、直リンク時にホームへ戻す規約と
          E2E が参照する testID を維持するため。 */}
      <Stack.Screen
        options={{
          title: t("機能一覧・更新情報"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="changelog-back-button"
            />
          ),
        }}
      />
      <ScrollView className="flex-1">
        <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
          {/* 最終更新は UPDATES の先頭（最新エントリ）の日付から取る */}
          <Text className="mt-2 text-xs text-muted">
            {t("最終更新:")} {lastUpdated}
          </Text>

          <Text className="mt-8 text-base font-semibold text-foreground">
            {t("このアプリでできること")}
          </Text>
          <View className="mt-3 gap-4">
            {FEATURES.map((feature) => (
              <View key={feature.title}>
                <Text className="text-sm font-medium text-foreground">
                  {feature.title}
                </Text>
                <Text className="mt-1 text-sm leading-6 text-secondary">
                  {feature.description}
                </Text>
              </View>
            ))}
          </View>

          <Text className="mt-10 text-base font-semibold text-foreground">
            {t("更新情報")}
          </Text>
          <View className="mt-3 gap-5">
            {UPDATES.map((entry) => (
              <View key={`${entry.date}-${entry.title}`}>
                <Text className="text-xs text-muted">{entry.date}</Text>
                <Text className="mt-1 text-sm font-medium text-foreground">
                  {entry.title}
                </Text>
                {entry.description ? (
                  <Text className="mt-1 text-sm leading-6 text-secondary">
                    {entry.description}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>

          <Text className="mt-10 text-base font-semibold text-foreground">
            {t("今後追加したい機能")}
          </Text>
          <Text className="mt-1 text-xs text-muted">
            {t("タップすると対応する GitHub issue を開きます。")}
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {PLANNED_FEATURES.map((item) => (
              <PlannedFeatureChip key={item.title} item={item} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlannedFeatureChip({ item }: { item: PlannedFeature }) {
  const { t } = useTranslation();
  const label = (
    <>
      <Text className="text-sm text-indigo-700 dark:text-indigo-300">
        {item.title}
      </Text>
      {item.issue ? (
        <Text className="text-xs text-primary-text"> #{item.issue}</Text>
      ) : null}
    </>
  );

  if (!item.issue) {
    return (
      <View className="flex-row items-center rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1.5">
        {label}
      </View>
    );
  }

  return (
    <Pressable
      className="flex-row items-center rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1.5"
      onPress={() => void Linking.openURL(`${ISSUES_URL}/${item.issue}`)}
      accessibilityRole="link"
      accessibilityLabel={t("{{title}}（GitHub issue を開く）", {
        title: item.title,
      })}
      testID={`planned-feature-${item.issue}`}
    >
      {label}
    </Pressable>
  );
}
