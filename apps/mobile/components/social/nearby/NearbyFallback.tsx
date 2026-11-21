import {
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

/**
 * 近づけて交換が使えないときの画面（issue #693。docs/design/nearby-exchange の
 * fallback-unsupported / fallback-denied）。理由を伝え、その場はマイ QR で
 * 交換できるよう QR を並べる。
 */
export function NearbyFallback({
  reason,
  qrValue,
  username,
  onShowQr,
}: {
  reason: "unsupported" | "denied";
  qrValue: string;
  username: string;
  /** マイ QR セグメントへ切り替える（共有・保存の操作はそちらにある）。 */
  onShowQr: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 16 + insets.bottom,
      }}
      testID={`nearby-fallback-${reason}`}
    >
      {reason === "unsupported" ? (
        <View className="flex-row self-stretch gap-2.5 rounded-xl bg-indigo-50 px-3.5 py-3 dark:bg-indigo-950">
          <Ionicons
            name="phone-portrait-outline"
            size={22}
            color={colors.primaryText}
          />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("この iPhone は「近づけて交換」に対応していません")}
            </Text>
            <Text className="mt-0.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              {t(
                "iPhone 11 以降（SE を除く）で使えます。いまは QR で交換しましょう。",
              )}
            </Text>
          </View>
        </View>
      ) : (
        <View className="items-center self-stretch">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <Ionicons
              name="lock-closed-outline"
              size={26}
              color={colors.textMuted}
            />
          </View>
          <Text className="mt-3 text-center text-[17px] font-bold text-slate-900 dark:text-slate-100">
            {t("近くの iPhone を探す許可がオフです")}
          </Text>
          <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-500 dark:text-slate-400">
            {t(
              "設定の「ローカルネットワーク」と「近くのデバイスとのやり取り」をオンにすると使えます。",
            )}
          </Text>
          <View className="mt-4 flex-row self-stretch gap-2.5">
            <TouchableOpacity
              className="flex-1 items-center rounded-lg bg-indigo-600 py-3"
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
              testID="nearby-open-settings"
            >
              <Text className="font-semibold text-white">
                {t("設定を開く")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 items-center rounded-lg bg-slate-100 py-3 dark:bg-slate-700"
              onPress={onShowQr}
              accessibilityRole="button"
              testID="nearby-fallback-show-qr"
            >
              <Text className="font-semibold text-slate-900 dark:text-slate-100">
                {t("QR で交換")}
              </Text>
            </TouchableOpacity>
          </View>
          <Text className="mt-6 text-xs text-slate-400 dark:text-slate-500">
            {t("いますぐ交換するなら")}
          </Text>
        </View>
      )}
      {/* QR は読み取り精度のため dark でも白いカードに描画する（マイ QR と同じ）。 */}
      <View className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
        <QRCode
          value={qrValue}
          size={reason === "denied" ? 150 : 190}
          testID="nearby-fallback-qr"
        />
      </View>
      <Text className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
        {username}
      </Text>
      <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {t("相手のカメラで読み取ってもらってください")}
      </Text>
      {reason === "unsupported" ? (
        <TouchableOpacity
          className="mt-6 flex-row items-center gap-1.5"
          onPress={onShowQr}
          accessibilityRole="button"
          testID="nearby-fallback-show-qr"
        >
          <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {t("リンクの共有・画像で保存")}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.primaryText}
          />
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}
