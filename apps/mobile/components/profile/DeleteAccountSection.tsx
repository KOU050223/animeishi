import { Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";

/**
 * アカウント削除セクション（App Store / Google Play 審査要件）。
 * 段階フロー（退会理由 → 消えるデータの確認 → 最終確認）の入口で、
 * タップで /delete-account へ遷移するだけを担う。削除実行と
 * 端末内データの後片付けは app/delete-account.tsx 側に閉じ込める。
 */
export function DeleteAccountSection() {
  const router = useRouter();

  return (
    <View className="mt-10 border-t border-slate-200 dark:border-slate-700 px-4 pt-6">
      <TouchableOpacity
        className="items-center rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 py-3"
        onPress={() => router.push("/delete-account")}
        accessibilityRole="button"
        accessibilityLabel="アカウントを削除"
      >
        <Text className="font-semibold text-red-600 dark:text-red-400">
          アカウントを削除
        </Text>
      </TouchableOpacity>
      <Text className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
        削除するとすべてのデータが失われ、元に戻せません
      </Text>
    </View>
  );
}
