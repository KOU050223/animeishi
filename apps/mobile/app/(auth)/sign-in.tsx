import { useAuth, useClerk, useSignIn } from "@clerk/expo";
import { Link, useRouter } from "expo-router";
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
import { DeviceTrustCodeForm } from "@/components/auth/DeviceTrustCodeForm";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";
import * as v from "valibot";
import { signInSchema } from "@/lib/validators";
import {
  getClerkErrorCode,
  throwIfAuthError,
  toAuthErrorMessage,
} from "@/lib/authErrors";
import { recoverExistingSession } from "@/lib/recoverExistingSession";
import { useSignOut } from "@/lib/useSignOut";
import { featureFlags } from "@/lib/featureFlags";
import {
  isReviewAccountEmail,
  requestDemoSignInTicket,
} from "@/lib/reviewAccount";
import { getIncompleteSignInMessage } from "@/lib/signInStatus";
import { useThemeColors } from "@/lib/theme";
import type { TranslationKey } from "@/lib/i18n/keys";

const INPUT_CLASS =
  "border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100";

// credentials: メールアドレスとパスワード / device-code: 新しい端末の確認コード
// （Clerk の Device Trust。https://clerk.com/docs/guides/secure/device-trust）
type Step = "credentials" | "device-code";

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const { isLoaded, isSignedIn } = useAuth();
  const signOut = useSignOut();
  const { client, setActive } = useClerk();
  const router = useRouter();
  const colors = useThemeColors();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  // 確認コードの送信先。応答待ちの間に入力欄が書き換えられても、実際に送った
  // アドレスを案内するため、入力値とは別に持つ。
  const [codeSentTo, setCodeSentTo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded || !signIn) return;

    const parsed = v.safeParse(signInSchema, { email, password });
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
      // 別アカウントへログインし直す場合、既存セッションが残っていると
      // Clerk が "You're already signed in." を返すため、先にサインアウトする
      if (isSignedIn) {
        await signOut();
      }

      // Core 3 のシグナル API は例外ではなく { error } を返す。
      // 下の catch ベースの処理（session_exists 復旧・エラー文言変換）を
      // そのまま使うため、throwIfAuthError で例外へ戻す。
      // 結果は戻り値ではなく signIn リソースの status / createdSessionId に反映される。
      const { error: signInError } = await signIn.password({
        identifier: parsed.output.email,
        password: parsed.output.password,
      });
      throwIfAuthError(signInError);

      if (signIn.status === "complete") {
        await finishSignIn();
      } else if (signIn.status === "needs_client_trust") {
        await handleNewDevice(parsed.output.email, parsed.output.password);
      } else {
        setError(getIncompleteSignInMessage(signIn.status, t));
      }
    } catch (err: unknown) {
      // session_exists は有効なセッションが既に残っている状態
      // （サインアップ直後にセッションだけ作成されたケース等）。
      // client 上にセッションがあっても isSignedIn=false だと
      // 遷移するだけでは AuthGuard に戻されてループするため、
      // 既存セッションを活性化してから遷移する。
      if (getClerkErrorCode(err) === "session_exists") {
        const recovered = await recoverExistingSession({
          client,
          setActive,
          signOut,
        });
        if (recovered === "activated") {
          router.replace("/");
        } else {
          setError(
            t(
              "既存のセッションを復元できませんでした。もう一度お試しください。",
            ),
          );
        }
        return;
      }
      setError(toAuthErrorMessage(err, t, "サインインに失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function finishSignIn() {
    if (!signIn) return;
    // finalize() は作成済みセッションの setActive を内部で行う。
    const { error: finalizeError } = await signIn.finalize();
    throwIfAuthError(finalizeError);
    router.replace("/");
  }

  // 新しい端末からのパスワードサインイン。デモアカウントはメールを受け取れない
  // 審査員・自動キャプチャが使うため、API が発行する ticket でサインインする。
  // それ以外は登録メールアドレスに確認コードを送って入力してもらう。
  async function handleNewDevice(identifier: string, secret: string) {
    if (!signIn) return;
    if (isReviewAccountEmail(identifier)) {
      const ticket = await requestDemoSignInTicket(identifier, secret);
      throwIfAuthError((await signIn.ticket({ ticket })).error);
      if (signIn.status === "complete") {
        await finishSignIn();
      } else {
        setError(getIncompleteSignInMessage(signIn.status, t));
      }
      return;
    }
    throwIfAuthError((await signIn.mfa.sendEmailCode()).error);
    setCodeSentTo(identifier);
    setStep("device-code");
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
          {/* PC (Web) で横に間延びしないよう幅を制限し、md 以上はカード表示 */}
          <View className="w-full max-w-[420px] self-center md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700 md:p-8">
            <Text className="text-3xl font-bold text-center mb-8 text-slate-900 dark:text-slate-100">
              {t("アニ名刺")}
            </Text>

            <Text className="text-xl font-semibold mb-6 text-slate-800 dark:text-slate-100">
              {t("サインイン")}
            </Text>

            {step === "device-code" ? (
              <DeviceTrustCodeForm
                email={codeSentTo}
                onSignedIn={() => router.replace("/")}
                onBack={() => {
                  setStep("credentials");
                  setError(null);
                }}
              />
            ) : (
              <>
                <Input
                  className={INPUT_CLASS}
                  placeholder={t("メールアドレス")}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  testID="email-input"
                />

                <Input
                  className={INPUT_CLASS}
                  placeholder={t("パスワード")}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                  testID="password-input"
                />

                <Link
                  href={{
                    pathname: "/(auth)/forgot-password",
                    params: email ? { email } : {},
                  }}
                  className="self-end mb-4"
                  testID="forgot-password-link"
                >
                  <Text className="text-sm text-indigo-600 dark:text-indigo-400">
                    {t("パスワードを忘れた場合")}
                  </Text>
                </Link>

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
                  onPress={handleSignIn}
                  disabled={loading}
                  testID="sign-in-button"
                >
                  {loading ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text className="text-white font-semibold text-base">
                      {t("サインイン")}
                    </Text>
                  )}
                </TouchableOpacity>

                {/* 外部プロバイダでのサインイン。本番で未設定のものはフラグで隠す */}
                {(featureFlags.googleSignIn || featureFlags.passkey) && (
                  <View className="flex-row items-center mb-4">
                    <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    <Text className="mx-3 text-sm text-slate-400 dark:text-slate-500">
                      {t("または")}
                    </Text>
                    <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  </View>
                )}
                {featureFlags.googleSignIn && (
                  <GoogleAuthButton onError={setError} />
                )}
                {featureFlags.passkey && (
                  <PasskeySignInButton onError={setError} />
                )}

                <View className="flex-row justify-center">
                  <Text className="text-slate-600 dark:text-slate-300">
                    {t("アカウントをお持ちでない方は ")}
                  </Text>
                  <Link href="/(auth)/sign-up" testID="sign-up-link">
                    <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                      {t("サインアップ")}
                    </Text>
                  </Link>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
