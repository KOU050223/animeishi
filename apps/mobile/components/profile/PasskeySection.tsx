import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useUser } from "@clerk/clerk-expo";
import { useTranslation } from "react-i18next";
import { toAuthErrorMessage } from "@/lib/authErrors";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** 結果メッセージの表示を呼び出し側（トースト等）に委ねる。 */
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

/**
 * パスキー登録セクション（issue #181）。Web 専用。
 * 表示自体は featureFlags.passkey（Web のみ true になり得る）で制御する。
 * createPasskey はブラウザ/OS のパスキー作成ダイアログを開き、
 * この端末（またはパスワードマネージャ）にクレデンシャルを登録する。
 */
export function PasskeySection({ onSuccess, onError }: Props) {
  const { t } = useTranslation();
  const { user } = useUser();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);

  const registeredCount = user?.passkeys?.length ?? 0;

  async function handleRegister() {
    if (!user) return;
    setLoading(true);
    try {
      await user.createPasskey();
      onSuccess(t("パスキーを登録しました"));
    } catch (err: unknown) {
      // NotAllowedError はダイアログのキャンセル等を含むため静かに握りつぶす。
      if (err instanceof Error && err.name === "NotAllowedError") {
        return;
      }
      onError(toAuthErrorMessage(err, "パスキーの登録に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
      <TouchableOpacity
        className="py-2"
        onPress={handleRegister}
        disabled={loading}
        testID="register-passkey-button"
        accessibilityRole="button"
        accessibilityLabel={t("パスキーを登録")}
      >
        {loading ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text className="font-semibold text-indigo-600 dark:text-indigo-300">
            {t("パスキーを登録")}
          </Text>
        )}
      </TouchableOpacity>
      {registeredCount > 0 && (
        <Text
          className="text-xs text-gray-500 dark:text-slate-400 pb-1"
          testID="passkey-registered-count"
        >
          {t("登録済みのパスキー: {{count}}件", { count: registeredCount })}
        </Text>
      )}
    </View>
  );
}
