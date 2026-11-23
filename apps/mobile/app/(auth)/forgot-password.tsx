import { useSignIn } from "@clerk/expo";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import * as v from "valibot";
import {
  passwordResetEmailSchema,
  passwordResetSchema,
} from "@/lib/validators";
import {
  getClerkErrorCode,
  throwIfAuthError,
  toAuthErrorMessage,
} from "@/lib/authErrors";
import { useThemeColors } from "@/lib/theme";
import type { TranslationKey } from "@/lib/i18n/keys";

const INPUT_CLASS =
  "border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100";

/**
 * パスワード再設定（issue #558）。
 * メールアドレス → メールに届いたコードと新しいパスワード → サインイン完了、の 2 段階。
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    if (!signIn) return;
    const parsed = v.safeParse(passwordResetEmailSchema, { email });
    if (!parsed.success) {
      setError(
        parsed.issues[0]?.message
          ? t(parsed.issues[0].message as TranslationKey)
          : t("入力内容を確認してください"),
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      throwIfAuthError(
        (await signIn.create({ identifier: parsed.output.email })).error,
      );
      throwIfAuthError((await signIn.resetPasswordEmailCode.sendCode()).error);
      setStep("reset");
    } catch (err: unknown) {
      // サインインの文言（「メールアドレスまたはパスワードが違います」）はこの画面では意味が通らない
      setError(
        getClerkErrorCode(err) === "form_identifier_not_found"
          ? t("このメールアドレスで登録されたアカウントが見つかりません")
          : toAuthErrorMessage(err, t, "認証コードを送信できませんでした"),
      );
    }
    setLoading(false);
  }

  async function handleReset() {
    if (!signIn) return;
    const parsed = v.safeParse(passwordResetSchema, {
      code,
      password,
      passwordConfirmation,
    });
    if (!parsed.success) {
      setError(
        parsed.issues[0]?.message
          ? t(parsed.issues[0].message as TranslationKey)
          : t("入力内容を確認してください"),
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // コードの検証が通った後で失敗した場合も、再送信時は検証済みなら飛ばす
      if (signIn.status !== "needs_new_password") {
        throwIfAuthError(
          (
            await signIn.resetPasswordEmailCode.verifyCode({
              code: parsed.output.code,
            })
          ).error,
        );
      }
      throwIfAuthError(
        (
          await signIn.resetPasswordEmailCode.submitPassword({
            password: parsed.output.password,
            // パスワードを忘れた理由が漏洩の可能性もあるため、他の端末のセッションは切る
            signOutOfOtherSessions: true,
          })
        ).error,
      );

      if (signIn.status === "complete") {
        throwIfAuthError((await signIn.finalize()).error);
        router.replace("/");
      } else {
        setError(
          t(
            "パスワードは変更されましたが、サインインを完了できませんでした。サインイン画面からお試しください。",
          ),
        );
      }
    } catch (err: unknown) {
      setError(
        toAuthErrorMessage(err, t, "パスワードを再設定できませんでした"),
      );
    }
    setLoading(false);
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-[420px] self-center md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700 md:p-8">
            <Text className="text-xl font-semibold mb-2 text-slate-800 dark:text-slate-100">
              {t("パスワードの再設定")}
            </Text>

            {step === "email" ? (
              <>
                <Text className="text-slate-500 dark:text-slate-400 mb-6">
                  {t(
                    "登録したメールアドレスを入力してください。パスワード再設定用の認証コードを送ります。",
                  )}
                </Text>
                <Input
                  className={INPUT_CLASS}
                  placeholder={t("メールアドレス")}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  testID="reset-email-input"
                />
              </>
            ) : (
              <>
                <Text className="text-slate-500 dark:text-slate-400 mb-6">
                  {t(
                    "{{email}} に送信された認証コードと、新しいパスワードを入力してください",
                    { email },
                  )}
                </Text>
                <Input
                  className={`${INPUT_CLASS} tracking-widest text-center`}
                  placeholder={t("認証コード")}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  testID="reset-code-input"
                />
                <Input
                  className={INPUT_CLASS}
                  placeholder={t("新しいパスワード（英字+数字、8文字以上）")}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  testID="reset-password-input"
                />
                <Input
                  className={INPUT_CLASS}
                  placeholder={t("新しいパスワード（確認）")}
                  value={passwordConfirmation}
                  onChangeText={setPasswordConfirmation}
                  secureTextEntry
                  autoComplete="new-password"
                  testID="reset-password-confirmation-input"
                />
              </>
            )}

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
              onPress={step === "email" ? handleSendCode : handleReset}
              disabled={loading}
              accessibilityRole="button"
              testID={
                step === "email"
                  ? "send-reset-code-button"
                  : "reset-password-button"
              }
            >
              {loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text className="text-white font-semibold text-base">
                  {step === "email"
                    ? t("認証コードを送る")
                    : t("パスワードを変更してサインイン")}
                </Text>
              )}
            </TouchableOpacity>

            {step === "reset" && (
              <TouchableOpacity
                className="items-center mb-4"
                onPress={handleSendCode}
                disabled={loading}
                accessibilityRole="button"
                testID="resend-reset-code-button"
              >
                <Text className="text-sm text-indigo-600 dark:text-indigo-400">
                  {t("認証コードを再送する")}
                </Text>
              </TouchableOpacity>
            )}

            <View className="flex-row justify-center">
              <Link href="/(auth)/sign-in" testID="back-to-sign-in-link">
                <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  {t("サインインに戻る")}
                </Text>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
