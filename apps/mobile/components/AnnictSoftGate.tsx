import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { AnnictFunnelSurface } from "@animeishi/observability";
import {
  annictErrorKey,
  useAnnictConnect,
  useAnnictFunnel,
  type AnnictConnectResult,
} from "@/lib/annict";
import type { TranslationKey } from "@/lib/i18n/keys";
import { useThemeColors } from "@/lib/theme";

/**
 * 記録/検索系の画面で、Annict 未連携時に表示するソフトゲート。
 *
 * 設計（docs/05・PR6）: 名刺/QR/フレンドは未連携でも使えるソフトゲート方針。
 * 記録/検索に触れた画面でだけ連携を促す。別ページへ飛ばさず、この場で
 * OAuth 連携フロー（useAnnictConnect）を開始して完結させる。
 *
 * `description` は画面ごとの文言を呼び出し側が渡す（基盤に既定文言を持たせない）。
 * `surface` はファネル計測（issue #64）の誘導元識別子。
 */
export function AnnictSoftGate({
  description,
  surface,
  testID,
}: {
  /** 画面文脈に応じた説明文（= 日本語キー。例: 呼び出し側が視聴履歴/作品検索用の文言を渡す）。 */
  description: TranslationKey;
  /** ファネル計測の誘導元（prompt_view / cta_tap / oauth_result の surface 属性）。 */
  surface: AnnictFunnelSurface;
  testID?: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { connect, isConnecting } = useAnnictConnect();
  const track = useAnnictFunnel(surface);
  const [errorText, setErrorText] = useState<string | null>(null);

  // このゲートは未連携時にだけ描画されるため、マウント＝誘導の表示とみなす。
  useEffect(() => {
    track("prompt_view");
  }, [track]);

  const onConnect = useCallback(async () => {
    setErrorText(null);
    track("cta_tap");
    const result: AnnictConnectResult = await connect({ surface });
    // 成功時は useAnnictConnect が連携状態クエリを invalidate するため、
    // 呼び出し側の isConnected が更新されてこのゲート自体が消える。
    if (result.status === "cancelled") {
      setErrorText(t("連携をキャンセルしました"));
    } else if (result.status === "error") {
      setErrorText(t(annictErrorKey(result.reason)));
    }
  }, [connect, surface, track, t]);

  return (
    <View
      className="items-center justify-center px-8 py-16"
      testID={testID ?? "annict-soft-gate"}
    >
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950">
        <Ionicons name="link-outline" size={28} color={colors.primaryText} />
      </View>

      <Text className="mb-2 text-center text-lg font-bold text-gray-900 dark:text-slate-100">
        {t("Annict 連携が必要です")}
      </Text>
      <Text className="mb-6 text-center text-sm leading-5 text-gray-500 dark:text-slate-400">
        {t(description)}
      </Text>

      {errorText && (
        <Text
          className="mb-4 text-center text-sm text-red-500 dark:text-red-400"
          testID="annict-soft-gate-error"
        >
          {errorText}
        </Text>
      )}

      <TouchableOpacity
        onPress={onConnect}
        disabled={isConnecting}
        className="w-full items-center rounded-xl bg-indigo-600 py-3"
        accessibilityRole="button"
        // 接続中はスピナーのみでテキストが消えるため、名前と状態を明示する。
        accessibilityLabel={isConnecting ? t("連携中...") : t("連携する")}
        accessibilityState={{ disabled: isConnecting, busy: isConnecting }}
      >
        {isConnecting ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text className="font-semibold text-white">{t("連携する")}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
