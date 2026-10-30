import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useRouter } from "expo-router";
import { BackButton } from "@/components/ui";
import {
  FEATURES,
  PLANNED_FEATURES,
  UPDATES,
  type PlannedFeature,
} from "@/lib/changelog";

const ISSUES_URL = "https://github.com/KOU050223/animeishi/issues";

// アプリの機能一覧・更新情報・今後の予定をまとめた静的ページ（issue #98）。
// 表示内容は lib/changelog.ts の静的データがソースオブトゥルース。
// 文言は日本語固定（support.tsx / LegalDocument と同じく i18n 対象外）。
export default function ChangelogScreen() {
  const router = useRouter();

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
      edges={["top", "bottom"]}
    >
      <ScrollView className="flex-1">
        <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
          <BackButton
            onPress={handleBack}
            className="-ml-2 mb-4 self-start"
            accessibilityLabel="戻る"
            testID="changelog-back-button"
          />

          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            機能一覧・更新情報
          </Text>
          {/* 最終更新は UPDATES の先頭（最新エントリ）の日付から取る */}
          <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            最終更新: {UPDATES[0].date}
          </Text>

          <Text className="mt-8 text-base font-semibold text-slate-900 dark:text-slate-100">
            このアプリでできること
          </Text>
          <View className="mt-3 gap-4">
            {FEATURES.map((feature) => (
              <View key={feature.title}>
                <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {feature.title}
                </Text>
                <Text className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
                  {feature.description}
                </Text>
              </View>
            ))}
          </View>

          <Text className="mt-10 text-base font-semibold text-slate-900 dark:text-slate-100">
            更新情報
          </Text>
          <View className="mt-3 gap-5">
            {UPDATES.map((entry) => (
              <View key={`${entry.date}-${entry.title}`}>
                <Text className="text-xs text-slate-400 dark:text-slate-500">
                  {entry.date}
                </Text>
                <Text className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {entry.title}
                </Text>
                {entry.description ? (
                  <Text className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
                    {entry.description}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>

          <Text className="mt-10 text-base font-semibold text-slate-900 dark:text-slate-100">
            今後追加したい機能
          </Text>
          <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            タップすると対応する GitHub issue を開きます。
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
  const label = (
    <>
      <Text className="text-sm text-indigo-700 dark:text-indigo-300">
        {item.title}
      </Text>
      {item.issue ? (
        <Text className="text-xs text-indigo-400 dark:text-indigo-500">
          {" "}
          #{item.issue}
        </Text>
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
      accessibilityLabel={`${item.title}（GitHub issue を開く）`}
      testID={`planned-feature-${item.issue}`}
    >
      {label}
    </Pressable>
  );
}
