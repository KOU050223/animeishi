import { useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { toAuthErrorMessage } from "@/lib/authErrors";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";

/**
 * サインアップ直後にパスキー登録を促す画面（issue #326）。
 * featureFlags.passkey が有効な環境（Web の開発インスタンス）でだけ
 * sign-up から遷移してくる。
 * (auth) グループには置かない: 表示時点で setActive 済み（= サインイン済み）
 * のため、AuthGuard の「サインイン済みは (auth) からホームへ戻す」
 * リダイレクトに引っかかってしまう。
 */
export default function PasskeyRegisterScreen() {
  const { t } = useTranslation();
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPasskeys = (user?.passkeys?.length ?? 0) > 0;

  useEffect(() => {
    // フラグ無効・登録済みパスキーありで直接 URL 等から来た場合は促さない。
    // 未サインインは AuthGuard がサインインへ戻すのでここでは扱わない。
    if (isLoaded && user && (!featureFlags.passkey || hasPasskeys)) {
      router.replace("/(tabs)");
    }
  }, [isLoaded, user, hasPasskeys, router]);

  async function handleRegister() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      await user.createPasskey();
      router.replace("/(tabs)");
    } catch (err: unknown) {
      // NotAllowedError はダイアログのキャンセル等を含むため静かに画面に留まる。
      if (err instanceof Error && err.name === "NotAllowedError") {
        return;
      }
      setError(toAuthErrorMessage(err, t, "パスキーの登録に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded || !user || !featureFlags.passkey || hasPasskeys) {
    // Clerk のロード待ち・リダイレクト待ちの間は促進 UI を見せない。
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900 items-center justify-center"
        edges={["top", "bottom"]}
      >
        <ActivityIndicator color={colors.primaryText} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <View className="flex-1 justify-center px-6 py-10">
        {/* sign-up と同じく PC (Web) で間延びしないよう幅を制限し、md 以上はカード表示 */}
        <View className="w-full max-w-[420px] self-center md:rounded-2xl md:border md:border-gray-200 md:dark:border-slate-700 md:p-8">
          <Text className="text-xl font-semibold mb-2 text-gray-800 dark:text-slate-100">
            {t("パスキーを登録しますか？")}
          </Text>
          <Text className="text-gray-500 dark:text-slate-400 mb-2">
            {t(
              "パスキーを登録すると、次回から Touch ID などで簡単にサインインできます",
            )}
          </Text>
          <Text className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            {t("あとからプロフィール画面でも登録できます")}
          </Text>

          {error && (
            <Text
              className="text-red-500 dark:text-red-400 text-sm mb-4"
              testID="error-message"
            >
              {error}
            </Text>
          )}

          <TouchableOpacity
            className="bg-indigo-600 rounded-lg py-4 items-center mb-4"
            onPress={handleRegister}
            disabled={loading}
            testID="register-passkey-button"
            accessibilityRole="button"
            accessibilityLabel={t("パスキーを登録")}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text className="text-white font-semibold text-base">
                {t("パスキーを登録")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="py-2 items-center"
            onPress={() => router.replace("/(tabs)")}
            disabled={loading}
            testID="skip-passkey-button"
            accessibilityRole="button"
            accessibilityLabel={t("あとで")}
          >
            <Text className="text-gray-500 dark:text-slate-400 font-semibold">
              {t("あとで")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
