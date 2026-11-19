import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ScanFallbackProps } from "./ScanFallback";

// ネイティブでは権限拒否は OS の設定で解除できるため、理由の提示と
// 再要求ボタンだけを出す。カメラ自体を使えない環境（Web 版）向けの
// 代替手段の案内は ScanFallback.web が担う（issue #595）。
export function ScanFallback({ reason, onRetry }: ScanFallbackProps) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-slate-600 dark:text-slate-300 text-center mb-4">
        {reason === "denied"
          ? t("QR コードをスキャンするにはカメラの許可が必要です")
          : t("カメラを起動できませんでした")}
      </Text>
      {onRetry ? (
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={
            reason === "denied" ? t("カメラの使用を許可") : t("再試行")
          }
          testID="scan-fallback-retry"
        >
          <Text className="text-white font-semibold">
            {reason === "denied" ? t("カメラを許可") : t("再試行")}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
