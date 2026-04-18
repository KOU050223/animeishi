import { useSignIn } from "@clerk/clerk-expo";
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
import { signInSchema } from "@/lib/validators";

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "入力内容を確認してください");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await signIn.create({
        identifier: parsed.data.email,
        password: parsed.data.password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "サインインに失敗しました";
      setError(message);
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
          Animeishi
        </Text>

        <Text className="text-xl font-semibold mb-6 text-gray-800">
          サインイン
        </Text>

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder="メールアドレス"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="email-input"
        />

        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base"
          placeholder="パスワード"
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
              サインイン
            </Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-gray-600">アカウントをお持ちでない方は </Text>
          <Link href="/(auth)/sign-up" testID="sign-up-link">
            <Text className="text-indigo-600 font-semibold">サインアップ</Text>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
