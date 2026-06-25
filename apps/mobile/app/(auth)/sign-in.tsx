import { useAuth, useSignIn } from "@clerk/clerk-expo";
import { Link, useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { signInSchema } from "@/lib/validators";
import { toAuthErrorMessage } from "@/lib/authErrors";

function getIncompleteSignInMessage(status: string | null, t: TFunction) {
  if (!status) {
    return t("auth.signIn.incomplete.default");
  }

  if (status === "needs_second_factor") {
    return t("auth.signIn.incomplete.needsSecondFactor");
  }

  if (status === "needs_identifier" || status === "needs_first_factor") {
    return t("auth.signIn.incomplete.needsIdentifier");
  }

  return t("auth.signIn.incomplete.withStatus", { status });
}

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? t("auth.validation.invalidInput"),
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

      const result = await signIn.create({
        identifier: parsed.data.email,
        password: parsed.data.password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)");
      } else {
        setError(getIncompleteSignInMessage(result.status, t));
      }
    } catch (err: unknown) {
      setError(toAuthErrorMessage(err, "auth.signIn.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-center mb-8 text-gray-900">
          {t("common.appName")}
        </Text>

        <Text className="text-xl font-semibold mb-6 text-gray-800">
          {t("auth.signIn.title")}
        </Text>

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signIn.emailPlaceholder")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="email-input"
        />

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signIn.passwordPlaceholder")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          testID="password-input"
        />

        {error && (
          <Text className="text-red-500 text-sm mb-4" testID="error-message">
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
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">
              {t("auth.signIn.submit")}
            </Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-gray-600">{t("auth.signIn.noAccount")}</Text>
          <Link href="/(auth)/sign-up" testID="sign-up-link">
            <Text className="text-indigo-600 font-semibold">
              {t("auth.signIn.toSignUp")}
            </Text>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
