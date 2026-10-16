import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth, useClerk, useSignIn } from "@clerk/clerk-expo";
import { useTranslation } from "react-i18next";
import { getClerkErrorCode, toAuthErrorMessage } from "@/lib/authErrors";
import { recoverExistingSession } from "@/lib/recoverExistingSession";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** エラーメッセージの表示を呼び出し側（画面の error 表示）に委ねる。 */
  onError: (message: string | null) => void;
};

/**
 * 「パスキーでサインイン」ボタン（issue #181）。Web 専用。
 * 表示自体は featureFlags.passkey（Web のみ true になり得る）で制御するため、
 * このコンポーネントはフラグ評価を持たず、押下時の処理だけを持つ。
 *
 * flow: "discoverable" はボタン押下をトリガーにブラウザ/OS の
 * パスキー選択ダイアログを開く方式（autofill は入力欄連動のため不採用）。
 */
export function PasskeySignInButton({ onError }: Props) {
  const { t } = useTranslation();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const { client } = useClerk();
  const router = useRouter();
  const colors = useThemeColors();

  const [loading, setLoading] = useState(false);

  async function handlePress() {
    if (!isLoaded || !signIn || !setActive) return;
    setLoading(true);
    onError(null);

    try {
      if (isSignedIn) {
        await signOut();
      }

      const attempt = await signIn.authenticateWithPasskey({
        flow: "discoverable",
      });

      if (attempt.status === "complete" && attempt.createdSessionId) {
        await setActive({ session: attempt.createdSessionId });
        router.replace("/(tabs)");
      } else {
        onError(t("パスキーでのサインインを完了できませんでした"));
      }
    } catch (err: unknown) {
      // WebAuthn の NotAllowedError は「キャンセル / タイムアウト / 未登録」を
      // まとめて含むため、ユーザー操作のキャンセルとして静かに握りつぶす。
      if (err instanceof Error && err.name === "NotAllowedError") {
        return;
      }
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
      onError(toAuthErrorMessage(err, "パスキーでのサインインに失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableOpacity
      className="border border-gray-300 dark:border-slate-600 rounded-lg py-4 items-center mb-4 flex-row justify-center"
      onPress={handlePress}
      disabled={loading}
      testID="passkey-sign-in-button"
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <>
          <Ionicons name="key-outline" size={18} color={colors.primaryText} />
          <Text className="text-gray-800 dark:text-slate-100 font-semibold text-base ml-2">
            {t("パスキーでサインイン")}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}
