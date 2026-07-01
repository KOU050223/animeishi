import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

// 連携完了後に戻す画面（Web と揃える）。
const RETURN_PATH = "/anime-list";

/**
 * Annict OAuth コールバックルートのフォールバック。
 *
 * 実体はプラットフォーム別に解決される:
 * - annict.web.tsx    ... Web の OAuth コールバック処理（exchange まで実行）
 * - annict.native.tsx ... ネイティブ（deep link は openAuthSessionAsync が処理）
 * どちらも解決されない環境向けに、安全に一覧へ戻すだけの実装を置く。
 */
export default function AnnictCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace(RETURN_PATH);
  }, [router]);

  return <View className="flex-1 bg-white" />;
}
