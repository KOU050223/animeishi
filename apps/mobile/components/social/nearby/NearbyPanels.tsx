import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import type { NearbyTapOutcome } from "@/lib/nearbyExchange";
import { useThemeColors } from "@/lib/theme";

/**
 * UWB 非対応の iPhone（16e・SE など）は距離を測れないので、近づけて
 * ではなくタップで交換することを最初に伝える。
 */
export function TapModeBanner() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View
      pointerEvents="none"
      className="absolute left-4 right-4 top-3 z-10 flex-row items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 dark:bg-indigo-950"
      testID="nearby-tap-mode-banner"
    >
      <Ionicons name="hand-left-outline" size={16} color={colors.primaryText} />
      <Text className="flex-1 text-xs leading-4 text-slate-700 dark:text-slate-200">
        {t("この iPhone は距離を測れないため、近くの人をタップして交換します")}
      </Text>
    </View>
  );
}

/** 画面下の案内（見出し・補足）と、その下に並べる一覧や知らせ。 */
export function NearbyHintPanel({
  title,
  subtitle,
  landed,
  bottom,
  children,
}: {
  title: string;
  subtitle: string;
  /** 成立した後は見出しを成功の色にする。 */
  landed: boolean;
  bottom: number;
  children?: ReactNode;
}) {
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-6 right-6 items-center"
      style={{ bottom }}
    >
      <Text
        className={`text-center text-[17px] font-bold ${
          landed
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-slate-900 dark:text-slate-100"
        }`}
        accessibilityLiveRegion="polite"
        testID="nearby-title"
      >
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-500 dark:text-slate-400">
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** 申し込みが断られた・返事が無かった、入れ替わりに失敗した、の知らせ。 */
export function NearbyNotices({
  outcome,
  failed,
}: {
  /** 出している間だけ渡す。 */
  outcome: NearbyTapOutcome | null;
  failed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {outcome ? (
        <Text
          className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400"
          accessibilityRole="alert"
          testID="nearby-request-outcome"
        >
          {outcome.kind === "declined"
            ? t("{{name}}さんとは交換しませんでした", {
                name: outcome.displayName,
              })
            : t("{{name}}さんから返事がありませんでした", {
                name: outcome.displayName,
              })}
        </Text>
      ) : null}
      {failed ? (
        <Text
          className="mt-2 text-center text-xs text-red-600 dark:text-red-400"
          accessibilityRole="alert"
          testID="nearby-failure-notice"
        >
          {t("うまく交換できませんでした。もう一度近づけてください")}
        </Text>
      ) : null}
    </>
  );
}

/** いつでもマイ QR へ切り替えられる導線。 */
export function ShowQrLink({
  bottom,
  disabled,
  onPress,
}: {
  bottom: number;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className="absolute self-center flex-row items-center gap-1.5 py-2"
      style={{ bottom }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID="nearby-show-qr"
    >
      <Ionicons name="qr-code-outline" size={16} color={colors.primaryText} />
      <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
        {t("QR で交換する")}
      </Text>
    </TouchableOpacity>
  );
}
