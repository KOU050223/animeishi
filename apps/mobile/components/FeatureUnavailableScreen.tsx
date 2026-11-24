import { Text, TouchableOpacity } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";

// 機能フラグで隠した画面（#750）にディープリンク・共有リンクで直接来たときの表示。
// 白画面やホームへの無言の差し戻しだと、リンクが壊れたのか区別できないため案内を出す。
export function FeatureUnavailableScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const goHome = () => router.replace("/");
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    goHome();
  };

  return (
    <SafeAreaView
      className="flex-1 items-center justify-center bg-white px-8 dark:bg-slate-900"
      edges={["bottom"]}
      testID="feature-unavailable"
    >
      <Stack.Screen
        options={{
          title: t("現在は利用できません"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="feature-unavailable-back"
            />
          ),
        }}
      />
      <Text className="text-center text-sm leading-5 text-slate-600 dark:text-slate-300">
        {t("この機能は現在利用できません。")}
      </Text>
      <TouchableOpacity
        className="mt-6 rounded-xl bg-indigo-600 px-8 py-3"
        onPress={goHome}
        accessibilityRole="button"
        accessibilityLabel={t("ホームへ戻る")}
        testID="feature-unavailable-home"
      >
        <Text className="font-semibold text-white">{t("ホームへ戻る")}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
