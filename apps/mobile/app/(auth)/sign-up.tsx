import { useAuth, useClerk, useSignUp } from "@clerk/expo";
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
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { signUpSchema } from "@/lib/validators";
import {
  getClerkErrorCode,
  throwIfAuthError,
  toAuthErrorMessage,
} from "@/lib/authErrors";
import { recoverExistingSession } from "@/lib/recoverExistingSession";
import { featureFlags } from "@/lib/featureFlags";
import { passkeyPromptPending } from "@/lib/passkeyPromptPending";
import { PasskeyRegisterPrompt } from "@/components/auth/PasskeyRegisterPrompt";
import { useThemeColors } from "@/lib/theme";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signUp } = useSignUp();
  const { isLoaded, signOut } = useAuth();
  const { client, setActive } = useClerk();
  const router = useRouter();
  const colors = useThemeColors();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [pendingPasskeyPrompt, setPendingPasskeyPrompt] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // サインアップ完了後の進行先（issue #326）。パスキーが使える環境では
  // ホームへ遷移する前に登録促進ステップをこの画面内で挟む。
  // 促進ステップも (auth) 内の表示のため、finalize（内部で setActive）で
  // isSignedIn が立つと AuthGuard の「サインイン済みは (auth) からホームへ」
  // に追い出される。
  // 追い出し抑止のフラグはガードの effect が走りうるすべてのタイミングに
  // 間に合わせる必要があるので、finalize より先に立てる。
  // 失敗時はエラー値を返して呼び出し側の catch へ伝え、成功時は null。
  async function activateSessionAndContinue(): Promise<unknown> {
    if (!signUp) return null;
    const showPasskeyPrompt = featureFlags.passkey;
    if (showPasskeyPrompt) passkeyPromptPending.current = true;
    // finalize() は { error } を返すが、ネットワーク障害等では例外も
    // あり得る。どちらで失敗しても促進フラグが残らないよう例外も捕捉する。
    const { error } = await signUp
      .finalize()
      .catch((err: unknown) => ({ error: err }));
    if (error) {
      passkeyPromptPending.current = false;
      return error;
    }
    if (showPasskeyPrompt) {
      setPendingPasskeyPrompt(true);
      return null;
    }
    router.replace("/(tabs)");
    return null;
  }

  function handlePasskeyPromptDone() {
    passkeyPromptPending.current = false;
    router.replace("/(tabs)");
  }

  async function handleSignUp() {
    if (!isLoaded || !signUp) return;

    const parsed = signUpSchema.safeParse({
      email,
      password,
      passwordConfirmation,
      username,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? t("入力内容を確認してください"),
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Core 3 のシグナル API は例外ではなく { error } を返す。
      // 下の catch ベースの処理（session_exists 復旧・エラー文言変換）を
      // そのまま使うため、throwIfAuthError で例外へ戻す。
      // 結果は戻り値ではなく signUp リソースの status 等に反映される。
      const { error: signUpError } = await signUp.password({
        emailAddress: parsed.data.email,
        password: parsed.data.password,
        username: parsed.data.username,
      });
      throwIfAuthError(signUpError);

      // メール認証が必須でない Clerk 設定では password() の時点で complete になる。
      // その場合は認証コード入力を挟まず、そのままセッションを有効化して完了する。
      if (signUp.status === "complete" && signUp.createdSessionId) {
        throwIfAuthError(await activateSessionAndContinue());
        return;
      }

      // メール認証が求められているときだけ認証コード画面へ進む。
      // 認証不要なインスタンスで無条件に sendEmailCode すると
      // 400 になるため、unverified/missing に email_address があるかで分岐する。
      const emailNeedsVerification =
        signUp.unverifiedFields?.includes("email_address") ||
        signUp.missingFields?.includes("email_address");
      if (emailNeedsVerification) {
        const { error: sendError } = await signUp.verifications.sendEmailCode();
        throwIfAuthError(sendError);
        setPendingVerification(true);
        return;
      }

      // complete でもメール認証待ちでもない（他の必須項目不足等）は継続できない。
      setError(
        t("サインアップを完了できませんでした。もう一度お試しください。"),
      );
    } catch (err: unknown) {
      // 既に有効なセッションがある場合は新規作成を再試行しても失敗するだけ。
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
          router.replace("/(tabs)");
        } else {
          setError(
            t(
              "既存のセッションを復元できませんでした。もう一度お試しください。",
            ),
          );
        }
        return;
      }
      setError(toAuthErrorMessage(err, t, "サインアップに失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!isLoaded || !signUp) return;

    setLoading(true);
    setError(null);

    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      throwIfAuthError(error);
      if (signUp.status === "complete" && signUp.createdSessionId) {
        throwIfAuthError(await activateSessionAndContinue());
      }
    } catch (err: unknown) {
      setError(toAuthErrorMessage(err, t, "認証コードの検証に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  if (pendingPasskeyPrompt) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top", "bottom"]}
      >
        <View className="flex-1 justify-center px-6 py-10">
          <PasskeyRegisterPrompt onDone={handlePasskeyPromptDone} />
        </View>
      </SafeAreaView>
    );
  }

  if (pendingVerification) {
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
                {t("メールを確認してください")}
              </Text>
              <Text className="text-slate-500 dark:text-slate-400 mb-6">
                {t("{{email}} に送信された認証コードを入力してください", {
                  email,
                })}
              </Text>

              <Input
                className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base tracking-widest text-center dark:text-slate-100"
                placeholder={t("認証コード")}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                testID="verification-code-input"
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
                className="bg-indigo-600 rounded-lg py-4 items-center"
                onPress={handleVerify}
                disabled={loading}
                testID="verify-button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text className="text-white font-semibold text-base">
                    {t("確認")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
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
              {t("アカウント作成")}
            </Text>

            <Input
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("メールアドレス")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="email-input"
            />

            <Input
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("ユーザー名")}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              testID="username-input"
            />

            <Input
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("パスワード（英字+数字、8文字以上）")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              testID="password-input"
            />

            <Input
              className="border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("パスワード（確認）")}
              value={passwordConfirmation}
              onChangeText={setPasswordConfirmation}
              secureTextEntry
              testID="password-confirmation-input"
            />

            {error && (
              <Text
                className="text-red-500 dark:text-red-400 text-sm mb-4"
                testID="error-message"
              >
                {error}
              </Text>
            )}

            {Platform.OS === "web" && (
              <View
                id="clerk-captcha"
                className="mb-4 items-center"
                testID="clerk-captcha"
              />
            )}

            <TouchableOpacity
              className="bg-indigo-600 rounded-lg py-4 items-center mb-4"
              onPress={handleSignUp}
              disabled={loading}
              testID="sign-up-button"
            >
              {loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text className="text-white font-semibold text-base">
                  {t("アカウント作成")}
                </Text>
              )}
            </TouchableOpacity>

            {/* 外部プロバイダでのサインアップ。本番で未設定の間はフラグで隠す */}
            {featureFlags.googleSignIn && (
              <>
                <View className="flex-row items-center mb-4">
                  <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <Text className="mx-3 text-sm text-slate-400 dark:text-slate-500">
                    {t("または")}
                  </Text>
                  <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                </View>
                <GoogleAuthButton onError={setError} />
              </>
            )}

            <Text className="text-center text-xs text-slate-500 dark:text-slate-400 mb-2">
              {t("アカウントを作成することで、以下に同意したものとみなします")}
            </Text>
            <View className="flex-row justify-center gap-4 mb-4">
              <Link href="/terms" testID="terms-link">
                <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  {t("利用規約")}
                </Text>
              </Link>
              <Link href="/privacy" testID="privacy-link">
                <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  {t("プライバシーポリシー")}
                </Text>
              </Link>
            </View>

            <View className="flex-row justify-center">
              <Text className="text-slate-600 dark:text-slate-300">
                {t("すでにアカウントをお持ちの方は ")}
              </Text>
              <Link href="/(auth)/sign-in" testID="sign-in-link">
                <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  {t("サインイン")}
                </Text>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
