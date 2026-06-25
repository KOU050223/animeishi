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
import { useTranslation } from "react-i18next";
import { signUpSchema } from "@/lib/validators";
import { toAuthErrorMessage } from "@/lib/authErrors";

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
        parsed.error.issues[0]?.message ?? t("auth.validation.invalidInput"),
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signUp.create({
        emailAddress: parsed.data.email,
        password: parsed.data.password,
        username: parsed.data.username,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err: unknown) {
      setError(toAuthErrorMessage(err, "auth.signUp.failed"));
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
      setError(toAuthErrorMessage(err, "auth.signUp.verify.failed"));
    } finally {
      setLoading(false);
    }
  }

  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-white"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-1 justify-center px-6">
          <Text className="text-xl font-semibold mb-2 text-gray-800">
            {t("auth.signUp.verify.title")}
          </Text>
          <Text className="text-gray-500 mb-6">
            {t("auth.signUp.verify.description", { email })}
          </Text>

          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base tracking-widest text-center"
            placeholder={t("auth.signUp.verify.codePlaceholder")}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            testID="verification-code-input"
          />

          {error && (
            <Text className="text-red-500 text-sm mb-4" testID="error-message">
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
                {t("auth.signUp.verify.submit")}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-bold text-center mb-8 text-gray-900">
          {t("common.appName")}
        </Text>

        <Text className="text-xl font-semibold mb-6 text-gray-800">
          {t("auth.signUp.title")}
        </Text>

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signUp.emailPlaceholder")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="email-input"
        />

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signUp.usernamePlaceholder")}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          testID="username-input"
        />

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signUp.passwordPlaceholder")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          testID="password-input"
        />

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder={t("auth.signUp.passwordConfirmationPlaceholder")}
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
              {t("auth.signUp.submit")}
            </Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-gray-600">{t("auth.signUp.haveAccount")}</Text>
          <Link href="/(auth)/sign-in" testID="sign-in-link">
            <Text className="text-indigo-600 font-semibold">
              {t("auth.signUp.toSignIn")}
            </Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
