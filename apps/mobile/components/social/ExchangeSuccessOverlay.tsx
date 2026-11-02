import { useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { useReducedMotion, ZoomIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MeishiCard } from "@/components/MeishiCard";
import { haptics } from "@/lib/haptics";
import { buildProfileUrl } from "@/lib/profileUrl";
import { fetchPublicProfile } from "@/lib/publicProfile";
import { useThemeColors } from "@/lib/theme";

export type ExchangeSuccessOverlayProps = {
  /** 交換相手のユーザー ID。 */
  uid: string;
  /** 閉じるボタン・スクリム・Android 戻るで呼ばれる。 */
  onClose: () => void;
  /**
   * 「プロフィールを見る」ボタンを出すか。
   * user/[uid] 画面から開いた場合はすでにその画面にいるため false にする。
   */
  showProfileLink?: boolean;
};

// カード登場の控えめなポップ（0.92 → 1.0）。Modal 自体の fade と合わせて
// 「スケール + フェードイン」程度の演出に留める。
const cardEntering = ZoomIn.withInitialValues({
  transform: [{ scale: 0.92 }],
}).duration(240);

/**
 * 名刺交換（フレンド追加）が成立した瞬間の演出（issue #414）。
 * 相手の名刺カードを全画面モーダルで見せ、開くたびに 1 回だけ
 * ハプティクス（notification success）を鳴らす。
 *
 * 相手の公開名刺データは app/user/[uid].tsx と同じ取得方法
 * （fetchPublicProfile / クエリキー public-profile）を使う。
 * [uid] 画面から開いた場合はキャッシュ済みで即座に描画される。
 *
 * 表示する側は `{ uid && <ExchangeSuccessOverlay uid={uid} ... /> }` のように
 * 条件レンダリングで使う（マウント = 開く）。
 */
export function ExchangeSuccessOverlay({
  uid,
  onClose,
  showProfileLink = true,
}: ExchangeSuccessOverlayProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();

  const { data: profile, isLoading } = useQuery({
    // app/user/[uid].tsx と同じクエリキー（無効化・キャッシュ共有のため）。
    queryKey: ["public-profile", uid],
    queryFn: async () => fetchPublicProfile(uid, await getToken()),
    retry: false,
  });

  useEffect(() => {
    // 成立の感触は視覚だけに頼らずハプティクスでも伝える（マウント = 開く）。
    haptics.success();
  }, []);

  const openProfile = () => {
    // モーダルを閉じてから遷移しないと、遷移先の上にモーダルが残る
    // （呼び出し側の画面はスタックに残ったままのため）。
    onClose();
    router.push({ pathname: "/user/[uid]", params: { uid } });
  };

  return (
    <Modal
      visible
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
      testID="exchange-success-modal"
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
          entering={reduceMotion ? undefined : cardEntering}
          testID="exchange-success-overlay"
        >
          <Text className="text-2xl font-bold text-white">
            {t("名刺交換成立")}
          </Text>
          <View className="w-full max-w-sm mt-6" style={{ minHeight: 140 }}>
            {profile ? (
              <MeishiCard
                username={profile.username}
                bio={profile.bio}
                favoriteQuote={profile.favoriteQuote}
                profileImageUrl={profile.profileImageUrl}
                profileUrl={buildProfileUrl(uid)}
              />
            ) : isLoading ? (
              <ActivityIndicator
                color="#ffffff"
                accessibilityLabel="読み込み中"
              />
            ) : null}
          </View>
          <View className="mt-8 self-stretch items-center gap-3">
            {showProfileLink ? (
              <TouchableOpacity
                className="bg-indigo-600 rounded-lg px-6 py-3 self-stretch items-center"
                onPress={openProfile}
                accessibilityRole="button"
                accessibilityLabel={t("プロフィールを見る")}
                testID="exchange-success-profile-link"
              >
                <Text className="text-white font-semibold">
                  {t("プロフィールを見る")}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              className="px-6 py-3 items-center"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("閉じる")}
              testID="exchange-success-close"
            >
              <Text className="text-white/80 font-medium">{t("閉じる")}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
