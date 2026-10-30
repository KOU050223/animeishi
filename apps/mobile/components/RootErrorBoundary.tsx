import { useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import type { ErrorBoundaryProps } from "expo-router";

/**
 * ルートレベルの ErrorBoundary。
 *
 * app/_layout.tsx から `ErrorBoundary` として再 export され、
 * expo-router が各ルートのレンダリング中に投げた例外を捕捉する。
 * Sentry.wrap はルートレイアウト自体の例外を握るが、子ルートの
 * クラッシュ時にはこの画面が再試行導線になる。
 */
export function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <View className="flex-1 bg-white dark:bg-slate-900 items-center justify-center px-8">
      <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
        {t("予期しないエラーが発生しました")}
      </Text>
      <Text className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6">
        {error.message}
      </Text>
      <TouchableOpacity
        className="bg-indigo-600 rounded-lg px-6 py-3"
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel={t("もう一度試す")}
      >
        <Text className="text-white font-semibold">{t("もう一度試す")}</Text>
      </TouchableOpacity>
    </View>
  );
}
