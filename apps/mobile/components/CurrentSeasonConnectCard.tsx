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
 * ホーム「今期視聴中」レールが未連携で空のとき、その枠に出す連携カード
 * （issue #424）。プレースホルダーの作品タイルを並べて「連携するとここに
 * 今期の作品が並ぶ」ことを伝える。閉じるボタンは付けない
 * （連携すれば自然に消える）。
 *
 * `description` / `connectLabel` は呼び出し側が画面文脈に応じて渡す。
 * `surface` はファネル計測（issue #64）の誘導元識別子。
 */
export function CurrentSeasonConnectCard({
  description,
  connectLabel,
  surface,
  testID,
}: {
  /** 「連携するとここに何が並ぶか」を説明する文言（= 日本語キー）。 */
  description: TranslationKey;
  /** 連携 CTA のボタンラベル（= 日本語キー）。 */
  connectLabel: TranslationKey;
  /** ファネル計測の誘導元（prompt_view / cta_tap / oauth_result の surface 属性）。 */
  surface: AnnictFunnelSurface;
  testID?: string;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { connect, isConnecting } = useAnnictConnect();
  const track = useAnnictFunnel(surface);
  const [errorText, setErrorText] = useState<string | null>(null);

  // このカードは未連携時にだけ描画されるため、マウント＝誘導の表示とみなす。
  useEffect(() => {
    track("prompt_view");
  }, [track]);

  const onConnect = useCallback(async () => {
    setErrorText(null);
    track("cta_tap");
    const result: AnnictConnectResult = await connect({ surface });
    // 成功時は useAnnictConnect が連携状態クエリを invalidate するため、
    // 呼び出し側の isConnected が更新されてこのカード自体が消える。
    if (result.status === "cancelled") {
      setErrorText(t("連携をキャンセルしました"));
    } else if (result.status === "error") {
      setErrorText(t(annictErrorKey(result.reason)));
    }
  }, [connect, surface, track, t]);

  return (
    <View
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
      testID={testID ?? "current-season-connect-card"}
    >
      <View className="mb-3 flex-row items-center gap-3">
        <View className="flex-row gap-2">
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              className="h-20 w-14 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-700"
            >
              <Ionicons name="tv-outline" size={20} color={colors.textFaint} />
            </View>
          ))}
        </View>
        <Text className="flex-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
          {t(description)}
        </Text>
      </View>

      {errorText && (
        <Text
          className="mb-2 text-xs text-red-500 dark:text-red-400"
          testID="current-season-connect-error"
        >
          {errorText}
        </Text>
      )}

      <TouchableOpacity
        onPress={onConnect}
        disabled={isConnecting}
        className="items-center rounded-lg bg-indigo-600 py-2.5"
        accessibilityRole="button"
        // 接続中はスピナーのみでテキストが消えるため、名前と状態を明示する。
        accessibilityLabel={isConnecting ? t("連携中...") : t(connectLabel)}
        accessibilityState={{ disabled: isConnecting, busy: isConnecting }}
      >
        {isConnecting ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text className="font-semibold text-white">{t(connectLabel)}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
