import { useSignUp } from "@clerk/clerk-expo";
import { Link, useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { signUpSchema } from "@/lib/validators";
import { getClerkErrorCode, toAuthErrorMessage } from "@/lib/authErrors";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    if (!isLoaded) return;

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
      const result = await signUp.create({
        emailAddress: parsed.data.email,
        password: parsed.data.password,
        username: parsed.data.username,
      });

      // メール認証が必須でない Clerk 設定では create の時点で complete になる。
      // その場合は認証コード入力を挟まず、そのままセッションを有効化して完了する。
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)");
        return;
      }

      // メール認証が求められているときだけ認証コード画面へ進む。
      // 認証不要なインスタンスで無条件に prepareEmailAddressVerification すると
      // 400 になるため、unverified/missing に email_address があるかで分岐する。
      const emailNeedsVerification =
        result.unverifiedFields?.includes("email_address") ||
        result.missingFields?.includes("email_address");
      if (emailNeedsVerification) {
        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });
        setPendingVerification(true);
        return;
      }

      // complete でもメール認証待ちでもない（他の必須項目不足等）は継続できない。
      setError(
        t("サインアップを完了できませんでした。もう一度お試しください。"),
      );
    } catch (err: unknown) {
      // 既に有効なセッションがある場合は新規作成を再試行しても失敗するだけなので、
      // エラー表示せずそのままホームへ進め、振り分けは AuthGuard に任せる。
      if (getClerkErrorCode(err) === "session_exists") {
        router.replace("/(tabs)");
        return;
      }
      setError(toAuthErrorMessage(err, "サインアップに失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!isLoaded) return;

    setLoading(true);
    setError(null);

    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)");
      }
    } catch (err: unknown) {
      setError(toAuthErrorMessage(err, "認証コードの検証に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  if (pendingVerification) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1 justify-center px-6">
            <Text className="text-xl font-semibold mb-2 text-gray-800">
              {t("メールを確認してください")}
            </Text>
            <Text className="text-gray-500 mb-6">
              {t("{{email}} に送信された認証コードを入力してください", {
                email,
              })}
            </Text>

            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base tracking-widest text-center"
              placeholder={t("認証コード")}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              testID="verification-code-input"
            />

            {error && (
              <Text
                className="text-red-500 text-sm mb-4"
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
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold text-base">
                  {t("確認")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-3xl font-bold text-center mb-8 text-gray-900">
            {t("アニ名刺")}
          </Text>

          <Text className="text-xl font-semibold mb-6 text-gray-800">
            {t("アカウント作成")}
          </Text>

          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
            placeholder={t("メールアドレス")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            testID="email-input"
          />

          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
            placeholder={t("ユーザー名")}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            testID="username-input"
          />

          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
            placeholder={t("パスワード（英字+数字、8文字以上）")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            testID="password-input"
          />

          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
            placeholder={t("パスワード（確認）")}
            value={passwordConfirmation}
            onChangeText={setPasswordConfirmation}
            secureTextEntry
            testID="password-confirmation-input"
          />

          {error && (
            <Text className="text-red-500 text-sm mb-4" testID="error-message">
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
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {t("アカウント作成")}
              </Text>
            )}
          </TouchableOpacity>

          <Text className="text-center text-xs text-gray-500 mb-2">
            {t("アカウントを作成することで、以下に同意したものとみなします")}
          </Text>
          <View className="flex-row justify-center gap-4 mb-4">
            <Link href="/terms" testID="terms-link">
              <Text className="text-indigo-600 font-semibold">
                {t("利用規約")}
              </Text>
            </Link>
            <Link href="/privacy" testID="privacy-link">
              <Text className="text-indigo-600 font-semibold">
                {t("プライバシーポリシー")}
              </Text>
            </Link>
          </View>

          <View className="flex-row justify-center">
            <Text className="text-gray-600">
              {t("すでにアカウントをお持ちの方は ")}
            </Text>
            <Link href="/(auth)/sign-in" testID="sign-in-link">
              <Text className="text-indigo-600 font-semibold">
                {t("サインイン")}
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
