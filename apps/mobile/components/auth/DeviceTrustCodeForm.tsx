import { useSignIn } from "@clerk/expo";
import type { TFunction } from "i18next";
import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import { throwIfAuthError, toAuthErrorMessage } from "@/lib/authErrors";
import { getIncompleteSignInMessage } from "@/lib/signInStatus";
import { useThemeColors } from "@/lib/theme";

type Props = {
  /** 確認コードの送信先（入力されたメールアドレス）。 */
  email: string;
  /** サインインが完了したとき（セッションは活性化済み）。 */
  onSignedIn: () => void;
  /** メールアドレスの入力に戻る。 */
  onBack: () => void;
};

type SignInResource = NonNullable<ReturnType<typeof useSignIn>["signIn"]>;

// try/catch はコンポーネントの外に置き、loading は Promise の finally で戻す
// （React Compiler がコンポーネント内の try...finally を扱えないため）。
// 戻り値はエラー文言で、成功なら null。
async function verifyCodeAndFinalize(
  signIn: SignInResource,
  code: string,
  t: TFunction,
): Promise<string | null> {
  try {
    throwIfAuthError((await signIn.mfa.verifyEmailCode({ code })).error);
    if (signIn.status !== "complete") {
      return getIncompleteSignInMessage(signIn.status, t);
    }
    // finalize() は作成済みセッションの setActive を内部で行う。
    throwIfAuthError((await signIn.finalize()).error);
    return null;
  } catch (err: unknown) {
    return toAuthErrorMessage(err, t, "認証コードを確認できませんでした");
  }
}

async function resendCode(
  signIn: SignInResource,
  t: TFunction,
): Promise<string | null> {
  try {
    throwIfAuthError((await signIn.mfa.sendEmailCode()).error);
    return null;
  } catch (err: unknown) {
    return toAuthErrorMessage(err, t, "認証コードを送信できませんでした");
  }
}

/**
 * 新しい端末からのパスワードサインインで、Clerk の Device Trust が求める
 * メールの確認コードを入力するステップ（https://clerk.com/docs/guides/secure/device-trust）。
 * 確認コードは呼び出し側が signIn.mfa.sendEmailCode() で送ってから表示する。
 */
export function DeviceTrustCodeForm({ email, onSignedIn, onBack }: Props) {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const colors = useThemeColors();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (!signIn) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t("認証コードを入力してください"));
      return;
    }

    setLoading(true);
    setError(null);
    const message = await verifyCodeAndFinalize(signIn, trimmed, t).finally(
      () => setLoading(false),
    );
    if (message) {
      setError(message);
      return;
    }
    onSignedIn();
  }

  async function handleResend() {
    if (!signIn) return;
    setLoading(true);
    setError(null);
    const message = await resendCode(signIn, t).finally(() =>
      setLoading(false),
    );
    setError(message);
  }

  return (
    <>
      <Text className="text-slate-500 dark:text-slate-400 mb-6">
        {t(
          "新しい端末からのサインインです。{{email}} に送信された認証コードを入力してください",
          { email },
        )}
      </Text>
      <Input
        className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100 tracking-widest text-center"
        placeholder={t("認証コード")}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        testID="device-code-input"
      />

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
        onPress={handleVerify}
        disabled={loading}
        accessibilityRole="button"
        testID="verify-device-code-button"
      >
        {loading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text className="text-white font-semibold text-base">
            {t("確認してサインイン")}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="items-center mb-4"
        onPress={handleResend}
        disabled={loading}
        accessibilityRole="button"
        testID="resend-device-code-button"
      >
        <Text className="text-sm text-indigo-600 dark:text-indigo-400">
          {t("認証コードを再送する")}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="items-center mb-4"
        onPress={onBack}
        disabled={loading}
        accessibilityRole="button"
        testID="back-to-credentials-button"
      >
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          {t("メールアドレスを入力し直す")}
        </Text>
      </TouchableOpacity>
    </>
  );
}
