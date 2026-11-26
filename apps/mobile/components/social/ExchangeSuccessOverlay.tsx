import { useEffect } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { useReducedMotion, ZoomIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { haptics } from "@/lib/haptics";
import type { PublicProfile } from "@/features/user/publicProfile";
import { publicProfileQueries } from "@/lib/queries/publicProfile";
import { useThemeColors } from "@/lib/theme";
import { useFriends } from "@/features/friends/useFriends";
import { CommonPoints } from "./CommonPoints";

export type ExchangeSuccessOverlayProps = {
  /** 交換相手のユーザー ID。 */
  uid: string;
  /** 閉じるボタン・スクリム・Android 戻るで呼ばれる。 */
  onClose: () => void;
  /**
   * 「プロフィールを見る」ボタンを出すか。
   * user/[uid] 画面から開いた場合はすでにその画面にいるため false にする。
   */
  showProfileLink?: boolean | undefined;
  /**
   * 「出会いを記録する」ボタンを出すときに渡す（issue #661）。
   * 押すとオーバーレイを閉じて呼び出し側の記録シートを開く。
   * オーバーレイの Modal 内に別の Modal を重ねないため、シートの
   * 表示状態は呼び出し側が持つ。
   */
  onRecordPress?: (() => void) | undefined;
  /**
   * 「自分の QR も見せる」ボタンを出すときに渡す（issue #682）。
   * 両手で渡し合う名刺交換らしく相互スキャンを促す導線。任意の操作
   * なので副ボタンとして置く。遷移先（マイ QR）の制御は呼び出し側。
   */
  onShowMyQr?: (() => void) | undefined;
  /**
   * 「お礼を送る」ボタンを出すときに渡す（issue #694）。
   * 押すとオーバーレイを閉じて呼び出し側の送信シートを開く。
   * オーバーレイの Modal 内に別の Modal を重ねないため、シートの
   * 表示状態は呼び出し側が持つ（onRecordPress と同じやり方）。
   */
  onSendThanks?: (() => void) | undefined;
  /**
   * この相手との交換記録の件数。「◯回目」の表示に使う（issue #662）。
   * 申請→承認など初回交換しかあり得ない呼び出しでは 1 を渡す。
   */
  meetingCount?: number | undefined;
};

// カード登場の控えめなポップ（0.92 → 1.0）。Modal 自体の fade と合わせて
// 「スケール + フェードイン」程度の演出に留める。
const cardEntering = ZoomIn.withInitialValues({
  transform: [{ scale: 0.92 }],
}).duration(240);

// 相手の名刺ドキュメントを返す公開 API は無いため、MeishiCard は使わず
// 公開プロフィールの項目だけで組む軽量カードにする（MeishiCard の
// classic テンプレートは閲覧者自身の favorites / watch history を
// 参照してしまう）。見た目は app/user/[uid].tsx のヘッダーに揃える。
function ExchangeCard({
  profile,
}: {
  profile: Pick<PublicProfile, "username" | "bio" | "profileImageUrl">;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="w-full rounded-2xl bg-white dark:bg-slate-800 px-6 py-6 items-center"
      testID="exchange-success-card"
    >
      {profile.profileImageUrl ? (
        <Image
          source={{ uri: profile.profileImageUrl }}
          className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700"
          accessibilityLabel={t("{{username}}のアイコン", {
            username: profile.username,
          })}
        />
      ) : (
        <View
          className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center"
          accessibilityLabel={t("{{username}}のアイコン", {
            username: profile.username,
          })}
        >
          <Text className="text-2xl text-secondary">
            {profile.username.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <Text className="text-xl font-bold text-foreground mt-3">
        {profile.username}
      </Text>
      {profile.bio ? (
        <Text className="text-sm text-muted mt-1 text-center">
          {profile.bio}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 名刺交換（フレンド追加）が成立した瞬間の演出（issue #414）。
 * 相手のカードを全画面モーダルで見せ、開くたびに 1 回だけ
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
  onRecordPress,
  onShowMyQr,
  onSendThanks,
  meetingCount,
}: ExchangeSuccessOverlayProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const { data: friends } = useFriends();

  // app/user/[uid].tsx と同じクエリキー（無効化・キャッシュ共有のため）。
  const { data: profile, isLoading } = useQuery(
    publicProfileQueries.detail.query({ uid, viewerId: userId }),
  );
  const cardProfile =
    profile ?? friends?.find((friend) => friend.friendId === uid);

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
          // reanimated の entering は省略可能プロパティなので、
          // reduceMotion 時はキーごと渡さない（exactOptionalPropertyTypes 対応）。
          {...(reduceMotion ? {} : { entering: cardEntering })}
          testID="exchange-success-overlay"
        >
          <Text className="text-2xl font-bold text-white">
            {t("名刺交換成立")}
          </Text>
          {/* 再会も含めた「◯回目」（issue #662）。再会履歴の入口になる
              合図として成立の下に添える。 */}
          {meetingCount != null && meetingCount > 0 ? (
            <Text
              className="text-sm font-medium text-white/80 mt-1"
              testID="exchange-success-count"
            >
              {t("{{count}}回目の出会い", { count: meetingCount })}
            </Text>
          ) : null}
          <ScrollView
            className="w-full max-w-sm mt-6"
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            {cardProfile ? (
              <ExchangeCard profile={cardProfile} />
            ) : isLoading ? (
              <ActivityIndicator
                color="#ffffff"
                accessibilityLabel={t("読み込み中")}
              />
            ) : null}
            <CommonPoints uid={uid} />
          </ScrollView>
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
            {onShowMyQr ? (
              <TouchableOpacity
                className="bg-white/15 border border-white/40 rounded-lg px-6 py-3 self-stretch items-center"
                onPress={onShowMyQr}
                accessibilityRole="button"
                accessibilityLabel={t("自分の QR も見せる")}
                testID="exchange-success-show-my-qr"
              >
                <Text className="text-white font-semibold">
                  {t("自分の QR も見せる")}
                </Text>
              </TouchableOpacity>
            ) : null}
            {onRecordPress ? (
              <TouchableOpacity
                className="bg-white/15 border border-white/40 rounded-lg px-6 py-3 self-stretch items-center"
                onPress={onRecordPress}
                accessibilityRole="button"
                accessibilityLabel={t("出会いを記録する")}
                testID="exchange-success-record-button"
              >
                <Text className="text-white font-semibold">
                  {t("出会いを記録する")}
                </Text>
              </TouchableOpacity>
            ) : null}
            {onSendThanks ? (
              <TouchableOpacity
                className="bg-white/15 border border-white/40 rounded-lg px-6 py-3 self-stretch items-center"
                onPress={onSendThanks}
                accessibilityRole="button"
                accessibilityLabel={t("お礼を送る")}
                testID="exchange-success-thanks-button"
              >
                <Text className="text-white font-semibold">
                  {t("お礼を送る")}
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
