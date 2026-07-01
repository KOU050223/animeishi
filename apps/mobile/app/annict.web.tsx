import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import { annictErrorKey, ANNICT_CONNECTION_QUERY_KEY } from "@/lib/annict";
import { exchangeAnnictWebCallback } from "@/lib/annict/useAnnictConnect.web";

// 連携完了後に戻す画面。作品検索から連携する導線が主のためアニメ一覧へ戻す。
const RETURN_PATH = "/anime-list";

type Phase =
  | { kind: "processing" }
  | { kind: "success" }
  | { kind: "error"; reason: string };

/**
 * Annict OAuth の Web コールバック着地ルート（/annict、Web 専用）。
 *
 * authorize 後に `https://<host>/annict?code=...&state=...` へ戻る。sessionStorage
 * の state と照合し、exchange(mode:web) を叩いてサーバー(D1)にトークンを暗号化
 * 保存する。成功後は連携元画面へ戻す。ネイティブは annict.native.tsx が担う。
 */
export default function AnnictCallbackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "processing" });
  // React 18 の StrictMode / 再マウントで exchange を二重実行しないためのガード。
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    void (async () => {
      const result = await exchangeAnnictWebCallback(
        window.location.href,
        getToken,
      );
      if (result.status !== "success") {
        setPhase({
          kind: "error",
          reason: result.status === "error" ? result.reason : "unexpected",
        });
        return;
      }
      // 連携状態を再取得させてから元画面へ戻す。
      await queryClient.invalidateQueries({
        queryKey: ANNICT_CONNECTION_QUERY_KEY,
      });
      setPhase({ kind: "success" });
      router.replace(RETURN_PATH);
    })();
  }, [getToken, queryClient, router]);

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      {phase.kind === "processing" && (
        <Text className="text-lg font-semibold text-gray-900">
          {t("連携中...")}
        </Text>
      )}
      {phase.kind === "success" && (
        <Text className="text-lg font-semibold text-gray-900">
          {t("Annict と連携しました")}
        </Text>
      )}
      {phase.kind === "error" && (
        <View className="items-center">
          <Text className="text-lg font-semibold text-red-600 mb-4 text-center">
            {t(annictErrorKey(phase.reason))}
          </Text>
          <TouchableOpacity
            className="bg-gray-200 rounded-lg px-6 py-3"
            onPress={() => router.replace(RETURN_PATH)}
            accessibilityRole="button"
            accessibilityLabel={t("キャンセル")}
          >
            <Text className="text-gray-700 font-semibold">
              {t("キャンセル")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
