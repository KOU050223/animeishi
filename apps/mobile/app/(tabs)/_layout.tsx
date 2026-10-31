import { Ionicons } from "@expo/vector-icons";
import { NativeTabs } from "expo-router/native-tabs";
import type { ComponentProps } from "react";
import { useThemeColors } from "@/lib/theme";

// SF Symbols / Material Icons ではなく Ionicons のままにし、NativeTabs 化で
// アイコンの見た目が変わらないようにする。
const tabIcon = (name: ComponentProps<typeof Ionicons>["name"]) => (
  <NativeTabs.Trigger.Icon
    src=<NativeTabs.Trigger.VectorIcon family={Ionicons} name={name} />
  />
);

export default function TabsLayout() {
  const colors = useThemeColors();

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
        <NativeTabs.Trigger.Label>ホーム</NativeTabs.Trigger.Label>
        {tabIcon("home-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library" accessibilityLabel="ライブラリタブ">
        {/* アニメ一覧・視聴履歴・推しを束ねるタブ（issue #170）。 */}
        <NativeTabs.Trigger.Label>ライブラリ</NativeTabs.Trigger.Label>
        {tabIcon("library-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="social" accessibilityLabel="QR・フレンドタブ">
        {/* QR（名刺交換）とフレンド一覧を束ねるタブ（issue #170）。 */}
        <NativeTabs.Trigger.Label>QR・フレンド</NativeTabs.Trigger.Label>
        {tabIcon("people-outline")}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="profile"
        accessibilityLabel="プロフィールタブ"
        testID="profile-tab-button"
      >
        <NativeTabs.Trigger.Label>プロフ</NativeTabs.Trigger.Label>
        {tabIcon("person-outline")}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
