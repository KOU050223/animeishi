import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth, useClerk } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { useGoogleAuth } from "@/lib/googleAuth";
import { getClerkErrorCode, toAuthErrorMessage } from "@/lib/authErrors";
import { recoverExistingSession } from "@/lib/recoverExistingSession";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** エラーメッセージの表示を呼び出し側（画面の error 表示）に委ねる。 */
  onError: (message: string | null) => void;
};

/**
 * 「Google で続ける」ボタン（issue #89）。
 * フロー本体は lib/googleAuth の拡張子分割実装（native: SSO ブラウザセッション /
 * web: ページリダイレクト）に委譲し、ここでは結果の遷移とエラー整形だけを扱う。
 */
export function GoogleAuthButton({ onError }: Props) {
  const { t } = useTranslation();
  const { startGoogleAuth } = useGoogleAuth();
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { client, setActive } = useClerk();
  const router = useRouter();
  const colors = useThemeColors();

  const [loading, setLoading] = useState(false);

  async function handlePress() {
    if (!isLoaded || !setActive) return;
    setLoading(true);
    onError(null);

    try {
      // メール/パスワードのサインインと同じく、別アカウントへの切替のため
      // 既存セッションが残っていれば先にサインアウトする。
      if (isSignedIn) {
        await signOut();
      }

      const result = await startGoogleAuth();

      if (result.status === "session-created") {
        await setActive({ session: result.sessionId });
        router.replace("/(tabs)");
      } else if (result.status === "incomplete") {
        onError(
          t(
            "Google でのサインインを完了できませんでした。もう一度お試しください。",
          ),
        );
      }
      // cancelled（ユーザーが閉じた）/ redirected（Web 遷移中）は表示しない。
    } catch (err: unknown) {
      // session_exists は有効なセッションが既に残っている状態。
      // メール/パスワードと同じく既存セッションを活性化して遷移する。
      if (getClerkErrorCode(err) === "session_exists") {
        const recovered = await recoverExistingSession({
          client,
          setActive,
          signOut,
        });
        if (recovered === "activated") {
          router.replace("/(tabs)");
        } else {
          onError(
            t(
              "既存のセッションを復元できませんでした。もう一度お試しください。",
            ),
          );
        }
        return;
      }
      onError(
        toAuthErrorMessage(err, t, "Google でのサインインに失敗しました"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableOpacity
      className="border border-slate-300 dark:border-slate-600 rounded-lg py-4 items-center mb-4 flex-row justify-center"
      onPress={handlePress}
      disabled={loading}
      testID="google-sign-in-button"
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={colors.primaryText} />
          <Text className="text-slate-800 dark:text-slate-100 font-semibold text-base ml-2">
            {t("Google で続ける")}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}
