import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { useReducedMotion, ZoomIn } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { haptics } from "@/lib/haptics";
import type { MiniMeishi } from "@/lib/qrParser";
import { useThemeColors } from "@/lib/theme";

export type ExchangeQueuedOverlayProps = {
  /** スキャンした相手のユーザー ID（ミニ名刺が無いときの名代に使う）。 */
  uid: string;
  /** ミニ名刺（`?mc=`）。無い・項目が欠けた QR では undefined のまま出す。 */
  miniMeishi?: MiniMeishi | undefined;
  /** 閉じるボタン・スクリム・Android 戻るで呼ばれる。 */
  onClose: () => void;
  /**
   * 「自分の QR も見せる」ボタンを出すときに渡す（issue #682）。
   * オフラインでも両手で渡し合えるよう相互スキャンを促す導線。任意の
   * 操作なので副ボタンとして置く。遷移先（マイ QR）の制御は呼び出し側。
   */
  onShowMyQr?: (() => void) | undefined;
};

// ExchangeSuccessOverlay と同じ控えめなポップ演出（0.92 → 1.0）。
const cardEntering = ZoomIn.withInitialValues({
  transform: [{ scale: 0.92 }],
}).duration(240);

function QueuedCard({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | undefined;
}) {
  const { t } = useTranslation();
  // オフラインではアバター画像を取れないことが多いため、読み込み失敗時は
  // 頭文字のアイコンに切り替える。
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <View
      className="w-full rounded-2xl bg-white dark:bg-slate-800 px-6 py-6 items-center"
      testID="exchange-queued-card"
    >
      {avatarUrl && !avatarFailed ? (
        <Image
          source={{ uri: avatarUrl }}
          className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700"
          accessibilityLabel={t("{{username}}のアイコン", { username: name })}
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <View
          className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center"
          accessibilityLabel={t("{{username}}のアイコン", { username: name })}
        >
          <Text className="text-2xl text-secondary">
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-3">
        {name}
      </Text>
    </View>
  );
}

/**
 * オフラインの読み取り側がスキャンを交換キューへ積んだときの受付画面
 * （issue #681、設計 docs/13_offline-exchange-design.md）。
 * 成立ではなく受付なので、QR のミニ名刺だけでカードを組み、
 * 「接続が回復したら交換が完了します」と表示する。相手のプロフィールは
 * オフラインでは取れないためネットワーク取得はしない。
 */
export function ExchangeQueuedOverlay({
  uid,
  miniMeishi,
  onClose,
  onShowMyQr,
}: ExchangeQueuedOverlayProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const name = miniMeishi?.username || uid;

  useEffect(() => {
    // 受け付けた感触は視覚だけに頼らずハプティクスでも伝える（マウント = 開く）。
    haptics.success();
  }, []);

  return (
    <Modal
      visible
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
      testID="exchange-queued-modal"
    >
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: colors.scrim }}
      >
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("閉じる")}
        />
        <Animated.View
          className="w-full items-center"
          // reanimated の entering は省略可能プロパティなので、
          // reduceMotion 時はキーごと渡さない（exactOptionalPropertyTypes 対応）。
          {...(reduceMotion ? {} : { entering: cardEntering })}
          testID="exchange-queued-overlay"
        >
          <Text className="text-2xl font-bold text-white">
            {t("名刺交換を受け付けました")}
          </Text>
          <ScrollView
            className="w-full max-w-sm mt-6"
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            <QueuedCard name={name} avatarUrl={miniMeishi?.avatarUrl} />
            <Text
              className="text-sm text-white/90 text-center mt-4"
              testID="exchange-queued-message"
            >
              {t("接続が回復したら名刺交換が完了します")}
            </Text>
          </ScrollView>
          <View className="mt-8 self-stretch items-center gap-3">
            {onShowMyQr ? (
              <TouchableOpacity
                className="bg-white/15 border border-white/40 rounded-lg px-6 py-3 self-stretch items-center"
                onPress={onShowMyQr}
                accessibilityRole="button"
                accessibilityLabel={t("自分の QR も見せる")}
                testID="exchange-queued-show-my-qr"
              >
                <Text className="text-white font-semibold">
                  {t("自分の QR も見せる")}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              className="px-6 py-3 items-center"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("閉じる")}
              testID="exchange-queued-close"
            >
              <Text className="text-white/80 font-medium">{t("閉じる")}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
