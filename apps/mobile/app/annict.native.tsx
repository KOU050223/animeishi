import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

// 連携完了後に戻す画面（Web と揃える）。
const RETURN_PATH = "/anime-list";

/**
 * Annict OAuth コールバックルート（ネイティブ）。
 *
 * ネイティブでは deep link を expo-web-browser の openAuthSessionAsync が
 * インターセプトして useAnnictConnect.native 内で完結するため、このルートには
 * 通常到達しない。万一到達した場合は安全に一覧へ戻す。
 */
export default function AnnictCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace(RETURN_PATH);
  }, [router]);

  return <View className="flex-1 bg-white" />;
}
