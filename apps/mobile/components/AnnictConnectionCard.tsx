import { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
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

/**
 * Annict 連携の状態表示と連携/解除操作をまとめたカード。
 *
 * 別ページに飛ばさず、profile や（将来の）ソフトゲート画面にインラインで
 * 埋め込んで使う。連携状態は SecureStore のトークン有無で判定する。
 */
export function AnnictConnectionCard() {
  const { t } = useTranslation();
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
        cancelLabel: t("annict.cancel"),
        destructive: true,
      },
    );
  }, [disconnect, t]);

  return (
    <View className="rounded-xl border border-gray-200 bg-white p-4">
      <View className="mb-2 flex-row items-center">
        <Ionicons name="link-outline" size={18} color="#4f46e5" />
        <Text className="ml-2 font-semibold text-gray-900">
          {t("annict.title")}
        </Text>
      </View>

      <Text className="mb-3 text-xs leading-5 text-gray-500">
        {t("annict.description")}
      </Text>

      <View className="mb-3 flex-row items-center">
        <Ionicons
          name={isConnected ? "checkmark-circle" : "ellipse-outline"}
          size={18}
          color={isConnected ? "#16a34a" : "#9ca3af"}
        />
        <Text
          className={`ml-2 text-sm ${
            isConnected ? "text-green-700" : "text-gray-500"
          }`}
        >
          {isConnected ? t("annict.connected") : t("annict.notConnected")}
        </Text>
      </View>

      {message && (
        <Text
          className={`mb-3 text-sm ${
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
          className="items-center rounded-lg border border-red-300 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-red-600">
            {t("annict.disconnect")}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onConnect}
          disabled={isConnecting}
          className="items-center rounded-lg bg-indigo-600 py-3"
          accessibilityRole="button"
        >
          {isConnecting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {t("annict.connect")}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
