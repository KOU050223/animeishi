import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { AnnictFunnelSurface } from "@animeishi/observability";
import {
  annictErrorKey,
  useAnnictConnect,
  useAnnictConnection,
  useAnnictFunnel,
  type AnnictConnectResult,
} from "@/lib/annict";
import type { TranslationKey } from "@/lib/i18n/keys";
import { useThemeColors } from "@/lib/theme";

/**
 * プロフィール画面上部に連携状態を 1 行で出す行（issue #424）。
 * 連携済みは ✓ 付きのステータス行で、タップすると従来の連携カード
 * （詳細・解除）の位置までスクロールする。未連携は「連携する」CTA を
 * その場で開始する。
 *
 * ラベルは呼び出し側が画面文脈に応じて渡す。
 * `surface` はファネル計測（issue #64）の誘導元識別子。
 */
export function AnnictConnectionStatusRow({
  connectedLabel,
  unconnectedLabel,
  connectLabel,
  surface,
  onShowDetails,
  testID,
}: {
  /** 連携済み時のステータス文言（= 日本語キー）。 */
  connectedLabel: TranslationKey;
  /** 未連携時のステータス文言（= 日本語キー）。 */
  unconnectedLabel: TranslationKey;
  /** 連携 CTA のボタンラベル（= 日本語キー）。 */
  connectLabel: TranslationKey;
  /** ファネル計測の誘導元（prompt_view / cta_tap / oauth_result の surface 属性）。 */
  surface: AnnictFunnelSurface;
  /** 連携済み行のタップ時。従来の連携カード（詳細・解除）への移動に使う。 */
  onShowDetails?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { isConnected, isLoading } = useAnnictConnection();
  const { connect, isConnecting } = useAnnictConnect();
  const track = useAnnictFunnel(surface);
  const [errorText, setErrorText] = useState<string | null>(null);

  // 連携 CTA が見えている状態（未連携かつ状態確定済み）だけを誘導の表示として数える。
  // AnnictConnectionCard と同じ条件に揃え、解除で未連携に戻ったときは再計上される。
  useEffect(() => {
    if (!isLoading && !isConnected) {
      track("prompt_view");
    }
  }, [isLoading, isConnected, track]);

  const onConnect = useCallback(async () => {
    setErrorText(null);
    track("cta_tap");
    const result: AnnictConnectResult = await connect({ surface });
    if (result.status === "cancelled") {
      setErrorText(t("連携をキャンセルしました"));
    } else if (result.status === "error") {
      setErrorText(t(annictErrorKey(result.reason)));
    }
  }, [connect, surface, track, t]);

  if (isLoading) {
    return (
      <View
        className="flex-row items-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
        testID={testID ?? "annict-connection-status"}
      >
        <ActivityIndicator size="small" color={colors.primaryText} />
      </View>
    );
  }

  if (isConnected) {
    return (
      <TouchableOpacity
        className="flex-row items-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
        onPress={onShowDetails}
        disabled={!onShowDetails}
        accessibilityRole={onShowDetails ? "button" : "text"}
        accessibilityLabel={t(connectedLabel)}
        testID={testID ?? "annict-connection-status"}
      >
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
        <Text className="ml-2 flex-1 text-sm text-green-700 dark:text-green-300">
          {t(connectedLabel)}
        </Text>
        {onShowDetails ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <View
      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
      testID={testID ?? "annict-connection-status"}
    >
      <View className="flex-row items-center">
        <Ionicons name="link-outline" size={16} color={colors.primaryText} />
        <Text className="ml-2 flex-1 text-sm text-slate-600 dark:text-slate-300">
          {t(unconnectedLabel)}
        </Text>
        <TouchableOpacity
          onPress={onConnect}
          disabled={isConnecting}
          className="items-center rounded-full bg-indigo-600 px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel={isConnecting ? t("連携中...") : t(connectLabel)}
          accessibilityState={{ disabled: isConnecting, busy: isConnecting }}
        >
          {isConnecting ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text className="text-sm font-semibold text-white">
              {t(connectLabel)}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {errorText ? (
        <Text
          className="mt-2 text-xs text-red-500 dark:text-red-400"
          testID="annict-connection-status-error"
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
