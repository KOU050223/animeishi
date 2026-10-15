import { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  annictErrorKey,
  useAnnictConnect,
  useAnnictConnection,
  type AnnictConnectResult,
} from "@/lib/annict";
import { confirm } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";

/**
 * Annict 連携の状態表示と連携/解除操作をまとめたカード。
 *
 * 別ページに飛ばさず、profile や（将来の）ソフトゲート画面にインラインで
 * 埋め込んで使う。連携状態は SecureStore のトークン有無で判定する。
 */
export function AnnictConnectionCard() {
  const { t } = useTranslation();
  const colors = useThemeColors();
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
      setMessage({ type: "success", text: t("Annict と連携しました") });
    } else if (result.status === "cancelled") {
      setMessage({ type: "error", text: t("連携をキャンセルしました") });
    } else {
      setMessage({ type: "error", text: t(annictErrorKey(result.reason)) });
    }
  }, [connect, t]);

  const onDisconnect = useCallback(() => {
    confirm(
      t("Annict 連携"),
      t("連携を解除する"),
      () => {
        // 削除や invalidation が失敗した場合に握りつぶさず UI へ反映する。
        void disconnect()
          .then(() => setMessage(null))
          .catch(() =>
            setMessage({
              type: "error",
              text: t("予期しないエラーが発生しました"),
            }),
          );
      },
      {
        confirmLabel: t("連携を解除する"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }, [disconnect, t]);

  return (
    <View className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <View className="mb-2 flex-row items-center">
        <Ionicons name="link-outline" size={18} color={colors.primaryText} />
        <Text className="ml-2 font-semibold text-gray-900 dark:text-slate-100">
          {t("Annict 連携")}
        </Text>
      </View>

      <Text className="mb-3 text-xs leading-5 text-gray-500 dark:text-slate-400">
        {t(
          "Annict と連携すると、視聴記録があなたのアニメ名刺に反映されます。記録は Annict 側で管理されます。",
        )}
      </Text>

      <View className="mb-3 flex-row items-center">
        <Ionicons
          name={isConnected ? "checkmark-circle" : "ellipse-outline"}
          size={18}
          color={isConnected ? colors.success : colors.textFaint}
        />
        <Text
          className={`ml-2 text-sm ${
            isConnected
              ? "text-green-700 dark:text-green-300"
              : "text-gray-500 dark:text-slate-400"
          }`}
        >
          {isConnected ? t("Annict と連携済み") : t("未連携")}
        </Text>
      </View>

      {message && (
        <Text
          className={`mb-3 text-sm ${
            message.type === "success"
              ? "text-green-600 dark:text-green-400"
              : "text-red-500 dark:text-red-400"
          }`}
          testID="annict-message"
        >
          {message.text}
        </Text>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : isConnected ? (
        <TouchableOpacity
          onPress={onDisconnect}
          className="items-center rounded-lg border border-red-300 dark:border-red-800 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-red-600 dark:text-red-400">
            {t("連携を解除する")}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onConnect}
          disabled={isConnecting}
          className="items-center rounded-lg bg-indigo-600 py-3"
          accessibilityRole="button"
          // 接続中はスピナーのみでテキストが消えるため、名前と状態を明示する。
          accessibilityLabel={
            isConnecting ? t("連携中...") : t("Annict と連携する")
          }
          accessibilityState={{ disabled: isConnecting, busy: isConnecting }}
        >
          {isConnecting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text className="font-semibold text-white">
              {t("Annict と連携する")}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
