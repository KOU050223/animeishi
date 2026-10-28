import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Platform, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

// tabBarIcon の color は型上 ColorValue（null | number | NativeColorValue を
// 含みうる）だが、タブバーが実際に渡すのは tint の文字列のみ。Ionicons は
// string | OpaqueColorValue しか受けないため、型のずれはここ 1 か所に閉じ込める。
const tabIcon =
  (name: ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  // 下端（ホームインジケータ等）との干渉を避けるため、safe area 分を上乗せしてタブバーを縦に広げる。
  const bottomInset = insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
        name="index"
        options={{
          title: "ホーム",
          tabBarIcon: tabIcon("home-outline"),
        }}
      />
      <Tabs.Screen
        name="anime-list"
        options={{
          title: "アニメ",
          tabBarIcon: tabIcon("list-outline"),
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: "QR",
          tabBarAccessibilityLabel: "QRコードタブ",
          tabBarIcon: tabIcon("qr-code-outline"),
        }}
      />
      <Tabs.Screen
        name="watch-history"
        options={{
          title: "視聴履歴",
          tabBarAccessibilityLabel: "視聴履歴タブ",
          tabBarIcon: tabIcon("time-outline"),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          // 7 タブでは 4 文字を超えるラベルが切れるため短い表記にする（#156）。
          title: "推し",
          tabBarAccessibilityLabel: "お気に入りタブ",
          tabBarIcon: tabIcon("heart-outline"),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: "フレンド",
          tabBarAccessibilityLabel: "フレンドタブ",
          tabBarIcon: tabIcon("people-outline"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "プロフ",
          tabBarAccessibilityLabel: "プロフィールタブ",
          tabBarButtonTestID: "profile-tab-button",
          tabBarIcon: tabIcon("person-outline"),
        }}
      />
    </Tabs>
  );
}
