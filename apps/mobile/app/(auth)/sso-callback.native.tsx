import { Link } from "expo-router";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

/**
 * ネイティブ版の /sso-callback は Google SSO のブラウザセッションが
 * リダイレクトを捕捉するため、通常ここへは到達しない。
 * 深いリンク経由で万が一着地した場合の受け皿としてスピナーだけを表示する
 * （issue #89。未認証ルート扱いで (auth) グループ内に置く）。
 */
export default function SsoCallbackScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900 items-center justify-center"
      edges={["top", "bottom"]}
    >
      <View className="items-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="mt-4 text-gray-600 dark:text-slate-300">
          {t("サインインを完了しています…")}
        </Text>
        {/* 万が一ブラウザセッション外で着地した場合の退避導線 */}
        <Link href="/sign-in" asChild>
          <TouchableOpacity
            className="mt-6"
            testID="sso-callback-back-to-sign-in"
          >
            <Text className="text-blue-600 dark:text-blue-400">
              {t("サインイン画面に戻る")}
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </SafeAreaView>
  );
}
