import { useClerk } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { handleOAuthRedirect } from "@/lib/googleAuth";
import { useThemeColors } from "@/lib/theme";

/**
 * Web の OAuth リダイレクト完了ルート（/sso-callback、issue #89）。
 * Google からの戻りで URL に付いた認証パラメータを clerk-js に処理させ、
 * フロー開始時に指定した redirectUrlComplete（= "/"）へ遷移する。
 * <AuthenticateWithRedirectCallback /> の自前実装版。
 */
export default function SsoCallbackScreen() {
  const clerk = useClerk();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [failed, setFailed] = useState(false);
  // StrictMode の二重 effect でも完了処理を一度だけにする。
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const navigate = async (to: string) => {
      // clerk-js はフローで指定した遷移先（絶対/相対 URL 両方あり得る）を渡す。
      // 同一オリジンは SPA 遷移、それ以外はブラウザ遷移に任せる。
      try {
        const url = new URL(to, window.location.origin);
        if (url.origin === window.location.origin) {
          router.replace((url.pathname + url.search + url.hash) as never);
          return;
        }
      } catch {
        // URL として解釈できない場合はそのまま router に渡す。
      }
      try {
        router.replace(to as never);
      } catch {
        window.location.href = to;
      }
    };

    handleOAuthRedirect({
      handleRedirectCallback: (params, customNavigate) =>
        clerk.handleRedirectCallback(params, customNavigate),
      navigate,
    }).catch(() => setFailed(true));
  }, [clerk, router]);

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900 items-center justify-center"
      edges={["top", "bottom"]}
    >
      {failed ? (
        <View className="items-center px-8">
          <Text
            className="text-red-500 dark:text-red-400 text-center mb-4"
            testID="sso-callback-error"
          >
            {t("サインインを完了できませんでした。もう一度お試しください。")}
          </Text>
        </View>
      ) : (
        <View className="items-center">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="mt-4 text-gray-600 dark:text-slate-300">
            {t("サインインを完了しています…")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
