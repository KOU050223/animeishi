import Ionicons from "@expo/vector-icons/Ionicons";
import { NativeTabs } from "expo-router/native-tabs";
import type { ComponentProps } from "react";
import { useThemeColors } from "@/lib/theme";
import { useReceivedFriendRequestCount } from "@/lib/useFriendRequests";
import { useTranslation } from "react-i18next";

// SF Symbols / Material Icons ではなく Ionicons のままにし、NativeTabs 化で
// アイコンの見た目が変わらないようにする。
const tabIcon = (name: ComponentProps<typeof Ionicons>["name"]) => (
  <NativeTabs.Trigger.Icon
    src=<NativeTabs.Trigger.VectorIcon family={Ionicons} name={name} />
  />
);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // 届いたフレンド申請をタブバッジで知らせる（issue #417。
  // プッシュ通知 #410 までの代用）。
  const friendRequestCount = useReceivedFriendRequestCount();

  return (
    <NativeTabs
      // tintColor は選択中タブのアイコン・ラベル色（旧 tabBarActiveTintColor）、
      // iconColor / labelStyle は未選択時の色（旧 tabBarInactiveTintColor）に相当する。
      tintColor={colors.primaryText}
      iconColor={colors.textMuted}
      labelStyle={{ color: colors.textMuted }}
      // iOS 26+ ではタブバー背景をシステムが描画するため効かないが、Android と
      // iOS 26 未満のために旧 tabBarStyle の backgroundColor / borderTopColor を引き継ぐ。
      backgroundColor={colors.background}
      shadowColor={colors.border}
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>{t("ホーム")}</NativeTabs.Trigger.Label>
        {tabIcon("home-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="library"
        accessibilityLabel={t("ライブラリタブ")}
      >
        {/* アニメ一覧・視聴履歴・推しを束ねるタブ（issue #170）。 */}
        <NativeTabs.Trigger.Label>{t("ライブラリ")}</NativeTabs.Trigger.Label>
        {tabIcon("library-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="hiroba" accessibilityLabel={t("ひろばタブ")}>
        {/* Tier 表・作品リスト・アニメ分析を束ねるタブ（issue #352）。 */}
        <NativeTabs.Trigger.Label>{t("ひろば")}</NativeTabs.Trigger.Label>
        {tabIcon("compass-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="social"
        accessibilityLabel={t("QR・フレンドタブ")}
      >
        {/* QR（名刺交換）とフレンド一覧を束ねるタブ（issue #170）。 */}
        <NativeTabs.Trigger.Label>{t("QR・フレンド")}</NativeTabs.Trigger.Label>
        {tabIcon("people-outline")}
        {friendRequestCount > 0 ? (
          <NativeTabs.Trigger.Badge>
            {String(friendRequestCount)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="profile"
        accessibilityLabel={t("プロフィールタブ")}
        testID="profile-tab-button"
      >
        <NativeTabs.Trigger.Label>{t("プロフ")}</NativeTabs.Trigger.Label>
        {tabIcon("person-outline")}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
