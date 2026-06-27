import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  useAnnictConnect,
  useAnnictConnection,
  type AnnictConnectResult,
} from "@/lib/annict";
import { confirm } from "@/lib/dialog";
import type { TranslationKey } from "@/lib/i18n/keys";

// 連携フローの失敗理由を i18n キーへ対応づける。
function errorKey(reason: string): TranslationKey {
  switch (reason) {
    case "not_configured":
      return "annict.errors.notConfigured";
    case "state_mismatch":
      return "annict.errors.stateMismatch";
    case "exchange_failed":
    case "browser_failed":
    case "unauthorized":
      return "annict.errors.exchangeFailed";
    default:
      return "annict.errors.unexpected";
  }
}

export default function AnnictScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isConnected, isLoading } = useAnnictConnection();
  const { connect, disconnect, isConnecting } = useAnnictConnect();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const onConnect = useCallback(async () => {
    setMessage(null);
    const result: AnnictConnectResult = await connect();
    if (result.status === "success") {
      setMessage({ type: "success", text: t("annict.success") });
    } else if (result.status === "cancelled") {
      setMessage({ type: "error", text: t("annict.errors.cancelled") });
    } else {
      setMessage({ type: "error", text: t(errorKey(result.reason)) });
    }
  }, [connect, t]);

  const onDisconnect = useCallback(() => {
    confirm(
      t("annict.title"),
      t("annict.disconnect"),
      () => {
        void disconnect();
        setMessage(null);
      },
      {
        confirmLabel: t("annict.disconnect"),
        cancelLabel: t("auth.signIn.toSignUp"),
        destructive: true,
      },
    );
  }, [disconnect, t]);

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 pt-12 pb-6">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mb-6 flex-row items-center"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color="#4f46e5" />
        </TouchableOpacity>

        <Text className="text-2xl font-bold text-gray-900 mb-3">
          {t("annict.title")}
        </Text>
        <Text className="text-base text-gray-600 mb-8 leading-6">
          {t("annict.description")}
        </Text>

        <View className="flex-row items-center mb-8">
          <Ionicons
            name={isConnected ? "checkmark-circle" : "ellipse-outline"}
            size={20}
            color={isConnected ? "#16a34a" : "#9ca3af"}
          />
          <Text
            className={`ml-2 text-base ${
              isConnected ? "text-green-700" : "text-gray-500"
            }`}
          >
            {isConnected ? t("annict.connected") : t("annict.notConnected")}
          </Text>
        </View>

        {message && (
          <Text
            className={`text-sm mb-4 ${
              message.type === "success" ? "text-green-600" : "text-red-500"
            }`}
            testID="annict-message"
          >
            {message.text}
          </Text>
        )}

        {isLoading ? (
          <ActivityIndicator color="#4f46e5" />
        ) : isConnected ? (
          <TouchableOpacity
            onPress={onDisconnect}
            className="border border-red-300 rounded-lg py-4 items-center"
            accessibilityRole="button"
          >
            <Text className="text-red-600 font-semibold text-base">
              {t("annict.disconnect")}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onConnect}
            disabled={isConnecting}
            className="bg-indigo-600 rounded-lg py-4 items-center"
            accessibilityRole="button"
          >
            {isConnecting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {t("annict.connect")}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}
