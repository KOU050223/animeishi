import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useUser } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import { toAuthErrorMessage } from "@/lib/authErrors";
import { passkeyPromptPending } from "@/lib/passkeyPromptPending";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** 登録・スキップ・促進不要のいずれかで促進を閉じるときに呼ぶ。 */
  onDone: () => void;
};

/**
 * サインアップ直後にパスキー登録を促すステップ（issue #326）。
 * featureFlags.passkey が有効な環境（Web の開発インスタンス）でだけ
 * sign-up から表示される。Web 専用機能のためネイティブでは到達しない。
 */
export function PasskeyRegisterPrompt({ onDone }: Props) {
  const { t } = useTranslation();
  const { user, isLoaded } = useUser();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPasskeys = (user?.passkeys?.length ?? 0) > 0;

  // 促進ステップを出なくなった理由（完了・想定外のアンマウント）を問わず
  // フラグを戻す。残ると以後の AuthGuard 判定が抑制されたままになる。
  useEffect(
    () => () => {
      passkeyPromptPending.current = false;
    },
    [],
  );

  useEffect(() => {
    // 既にパスキーを持っているユーザーには出さない（仕様）。
    if (isLoaded && user && hasPasskeys) onDone();
  }, [isLoaded, user, hasPasskeys, onDone]);

  async function handleRegister() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      await user.createPasskey();
    } catch (err: unknown) {
      setLoading(false);
      // NotAllowedError はダイアログのキャンセル等を含むため静かに画面に留まる。
      if (err instanceof Error && err.name === "NotAllowedError") {
        return;
      }
      setError(toAuthErrorMessage(err, t, "パスキーの登録に失敗しました"));
      return;
    }
    onDone();
  }

  if (!isLoaded || !user || hasPasskeys) {
    // Clerk のロード待ち・登録済みで onDone 待ちの間は促進 UI を見せない。
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.primaryText} />
      </View>
    );
  }

  return (
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
        onPress={onDone}
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
  );
}
