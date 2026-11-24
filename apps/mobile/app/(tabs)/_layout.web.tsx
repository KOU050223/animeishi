import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Platform, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";
import { useReceivedFriendRequestCount } from "@/lib/useFriendRequests";
import { useTranslation } from "react-i18next";

// tabBarIcon の color は型上 ColorValue（null | number | NativeColorValue を
// 含みうる）だが、タブバーが実際に渡すのは tint の文字列のみ。Ionicons は
// string | OpaqueColorValue しか受けないため、型のずれはここ 1 か所に閉じ込める。
const tabIcon =
  (name: ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  // 下端（ホームインジケータ等）との干渉を避けるため、safe area 分を上乗せしてタブバーを縦に広げる。
  const bottomInset = insets.bottom;
  // 届いたフレンド申請をタブバッジで知らせる（issue #417。
  // プッシュ通知 #410 までの代用）。
  const friendRequestCount = useReceivedFriendRequestCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Web では初回タブ切替まで画面モジュールを待つと、遷移後に前画面の
        // 残像や空白が見えるため、タブ画面を先にマウントする。
        lazy: false,
        // 選択中のタブはアイコン・ラベルともに暗背景でも読める強調色にする
        // （dark で primary の塗り色のままだと slate-900 背景上のコントラストが足りない）。
        tabBarActiveTintColor: colors.primaryText,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          height: 64 + bottomInset,
          paddingTop: 8,
          paddingBottom: bottomInset + 8,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: Platform.OS === "web" ? 4 : 0,
        },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: t("ホーム"),
          tabBarIcon: tabIcon("home-outline"),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          // アニメ一覧・視聴履歴・推しを束ねるタブ（issue #170）。
          title: t("ライブラリ"),
          tabBarAccessibilityLabel: t("ライブラリタブ"),
          tabBarIcon: tabIcon("library-outline"),
        }}
      />
      <Tabs.Screen
        name="hiroba"
        options={{
          // Tier 表・作品リスト・アニメ分析を束ねるタブ（issue #352）。
          title: t("ひろば"),
          tabBarAccessibilityLabel: t("ひろばタブ"),
          tabBarIcon: tabIcon("compass-outline"),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          // QR（名刺交換）とフレンド一覧を束ねるタブ（issue #170）。
          title: t("QR・フレンド"),
          tabBarAccessibilityLabel: t("QR・フレンドタブ"),
          // tabBarBadge は省略可能プロパティなので、未指定時はキーごと渡さない。
          ...(friendRequestCount > 0
            ? { tabBarBadge: friendRequestCount }
            : {}),
          tabBarIcon: tabIcon("people-outline"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("プロフ"),
          tabBarAccessibilityLabel: t("プロフィールタブ"),
          tabBarButtonTestID: "profile-tab-button",
          tabBarIcon: tabIcon("person-outline"),
        }}
      />
    </Tabs>
  );
}
