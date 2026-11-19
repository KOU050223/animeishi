import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/lib/theme";
import type { ScanFallbackProps } from "./ScanFallback";

// Web 版のスキャン不可時の案内（issue #595）。カメラが無い・ブラウザが
// 許可していない環境では CameraView が映像を出せない（「メディアを
// 再生できません」のまま空白になる）ため、理由の説明と、アプリに実在
// する代替手段（アプリでスキャン / プロフィール URL / ひろば「みつける」）
// を案内する。
export function ScanFallback({ reason, onRetry }: ScanFallbackProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow items-center justify-center px-8 py-6"
      testID="scan-fallback"
    >
      <View className="w-full max-w-md items-center">
        <Text className="text-lg font-bold text-slate-900 dark:text-slate-100 text-center">
          {t("カメラで QR コードをスキャンできません")}
        </Text>
        <Text className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center">
          {reason === "denied"
            ? t("ブラウザでカメラの使用が許可されていません")
            : t(
                "この環境ではカメラを利用できません。カメラが接続されていないか、ブラウザがカメラへのアクセスを許可していない可能性があります",
              )}
        </Text>
        {onRetry ? (
          <TouchableOpacity
            className="mt-4 bg-indigo-600 rounded-lg px-6 py-3"
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

        <View className="mt-8 self-stretch rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("ほかの方法で名刺を交換する")}
          </Text>
          <View className="mt-2 gap-2">
            {[
              t(
                "iOS / Android アプリの「スキャン」で相手の QR コードを読み取る",
              ),
              t(
                "相手にプロフィールのリンク（マイQR の「リンクを共有」「リンクをコピー」）を送ってもらい、その URL をブラウザで開く",
              ),
              t("ひろばの「みつける」で相手の公開名刺を探す"),
            ].map((line) => (
              <Text
                key={line}
                className="text-sm text-slate-500 dark:text-slate-400"
              >
                {`・${line}`}
              </Text>
            ))}
          </View>
          <TouchableOpacity
            className="mt-4 flex-row items-center justify-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 py-2.5"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/hiroba",
                params: { section: "discover", target: "users" },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t("ひろばで名刺を探す")}
            testID="scan-fallback-hiroba"
          >
            <Ionicons name="search" size={15} color={colors.primaryText} />
            <Text className="text-sm font-medium text-indigo-600 dark:text-indigo-300">
              {t("ひろばで名刺を探す")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}
