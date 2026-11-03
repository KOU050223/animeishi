import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useIncomingShare } from "expo-sharing";
import { useTranslation } from "react-i18next";

import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { extractUserIdFromSharedText } from "@/lib/incomingShare/extractUserId";
import { scanQrFromImage } from "@/lib/incomingShare";
import { useThemeColors } from "@/lib/theme";

/**
 * 他アプリからの共有（expo-sharing の受信）の受け皿画面（issue #316）。
 *
 * `+native-intent.ts` が `<scheme>://expo-sharing` をここへ振り替える。
 * - テキスト / URL 共有: 名刺 URL から uid を取り出して user/[uid] を開く
 * - 画像共有: 画像内の QR を読み取り、同じく user/[uid] を開く
 * - Animeishi の名刺以外が来たらエラー表示で終える
 */
export default function IncomingShareScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const {
    sharedPayloads,
    resolvedSharedPayloads,
    isResolving,
    error,
    clearSharedPayloads,
  } = useIncomingShare();
  // 画像内 QR の読み取り結果が名刺でなかった場合だけ状態が要る。
  // それ以外の失敗（名刺でないテキスト・対象外の型）は共有内容から導出する。
  const [scanFailed, setScanFailed] = useState(false);
  // 処理済みペイロードの印。解決完了・クリア後の再レンダーで同じ共有を
  // 二度処理しないため。別の共有が届いたときはキーが変わるので再処理される。
  const handledKeyRef = useRef<string | null>(null);

  const textUserId =
    sharedPayloads
      .filter((p) => p.shareType === "text" || p.shareType === "url")
      .map((p) => extractUserIdFromSharedText(p.value))
      .find(Boolean) ?? null;
  const imagePayload = sharedPayloads.find((p) => p.shareType === "image");
  // 解決済み URI を優先し、なければ生の value（ファイル URI）を使う
  const imageUri =
    resolvedSharedPayloads.find(
      (p) => p.contentType === "image" && p.contentUri,
    )?.contentUri ?? imagePayload?.value;

  // 名刺として処理できない共有（名刺でないテキスト / 対象外の型のみ /
  // 画像の URI が確定しなかった）か、共有を伴わずに開かれた場合は
  // エラー表示で終える。
  const failed =
    !!error ||
    scanFailed ||
    (sharedPayloads.length === 0 && !isResolving) ||
    (sharedPayloads.length > 0 && !textUserId && !imageUri && !isResolving);

  useEffect(() => {
    if (sharedPayloads.length === 0) return;

    const key = sharedPayloads
      .map((p) => `${p.shareType}|${p.value}`)
      .join("\n");
    if (handledKeyRef.current === key) return;

    if (textUserId) {
      handledKeyRef.current = key;
      clearSharedPayloads();
      router.replace({ pathname: "/user/[uid]", params: { uid: textUserId } });
      return;
    }

    // 画像の URI がまだ確定していないなら、解決結果またはエラーの
    // 再レンダーを待つ（失敗判定は描画側の導出が担う）
    if (!imageUri) return;

    handledKeyRef.current = key;
    void (async () => {
      try {
        const codes = await scanQrFromImage(imageUri);
        const userId =
          codes
            .map((code) => extractUserIdFromSharedText(code))
            .find(Boolean) ?? null;
        clearSharedPayloads();
        if (userId) {
          router.replace({ pathname: "/user/[uid]", params: { uid: userId } });
        } else {
          setScanFailed(true);
        }
      } catch {
        clearSharedPayloads();
        setScanFailed(true);
      }
    })();
  }, [sharedPayloads, imageUri, textUserId, clearSharedPayloads, router]);

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  if (failed) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["top", "bottom"]}
      >
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-bold text-slate-900 dark:text-slate-100 text-center">
            {t("名刺を開けませんでした")}
          </Text>
          <Text className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center">
            {t("Animeishi の名刺 URL か、名刺 QR の画像を共有してください")}
          </Text>
          <TouchableOpacity
            className="mt-6 rounded-lg bg-purple-600 px-6 py-3"
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t("閉じる")}
            testID="incoming-share-close-button"
          >
            <Text className="text-base font-semibold text-white">
              {t("閉じる")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-slate-900">
      <ActivityIndicator
        size="large"
        color={colors.primary}
        accessibilityLabel={t("名刺を開いています…")}
      />
      <Text className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        {t("名刺を開いています…")}
      </Text>
    </View>
  );
}
