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
import type { TFunction } from "i18next";
import { Input } from "@/components/ui";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";
import { signInSchema } from "@/lib/validators";
import {
  getClerkErrorCode,
  throwIfAuthError,
  toAuthErrorMessage,
} from "@/lib/authErrors";
import { recoverExistingSession } from "@/lib/recoverExistingSession";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";

function getIncompleteSignInMessage(status: string | null, t: TFunction) {
  if (!status) {
    return t("サインインを完了できませんでした。もう一度お試しください。");
  }

  if (status === "needs_second_factor") {
    return t("二要素認証が必要ですが、この画面ではまだ対応していません。");
  }

  if (status === "needs_identifier" || status === "needs_first_factor") {
    return t("メールアドレスまたはパスワードを確認してください。");
  }

  return t("サインインを完了できませんでした。状態: {{status}}", { status });
}

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { client, setActive } = useClerk();
  const router = useRouter();
  const colors = useThemeColors();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded || !signIn) return;

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? t("入力内容を確認してください"),
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
        identifier: parsed.data.email,
        password: parsed.data.password,
      });
      throwIfAuthError(signInError);

      if (signIn.status === "complete") {
        // finalize() は作成済みセッションの setActive を内部で行う。
        const { error: finalizeError } = await signIn.finalize();
        throwIfAuthError(finalizeError);
        router.replace("/(tabs)");
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
      setError(toAuthErrorMessage(err, t, "サインインに失敗しました"));
    } finally {
      setLoading(false);
    }
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
          <View className="w-full max-w-[420px] self-center md:rounded-2xl md:border md:border-gray-200 md:dark:border-slate-700 md:p-8">
            <Text className="text-3xl font-bold text-center mb-8 text-gray-900 dark:text-slate-100">
              {t("アニ名刺")}
            </Text>

            <Text className="text-xl font-semibold mb-6 text-gray-800 dark:text-slate-100">
              {t("サインイン")}
            </Text>

            <Input
              className="border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("メールアドレス")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="email-input"
            />

            <Input
              className="border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 mb-4 text-base dark:text-slate-100"
              placeholder={t("パスワード")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              testID="password-input"
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
                <View className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
                <Text className="mx-3 text-sm text-gray-400 dark:text-slate-500">
                  {t("または")}
                </Text>
                <View className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
              </View>
            )}
            {featureFlags.googleSignIn && (
              <GoogleAuthButton onError={setError} />
            )}
            {featureFlags.passkey && <PasskeySignInButton onError={setError} />}

            <View className="flex-row justify-center">
              <Text className="text-gray-600 dark:text-slate-300">
                {t("アカウントをお持ちでない方は ")}
              </Text>
              <Link href="/(auth)/sign-up" testID="sign-up-link">
                <Text className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  {t("サインアップ")}
                </Text>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
