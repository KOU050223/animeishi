import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="anime-list"
        options={{
          title: "アニメ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: "QR",
          tabBarAccessibilityLabel: "QRコードタブ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="qr-code-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="watch-history"
        options={{
          title: "視聴履歴",
          tabBarAccessibilityLabel: "視聴履歴タブ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          // 7 タブでは 4 文字を超えるラベルが切れるため短い表記にする（#156）。
          title: "推し",
          tabBarAccessibilityLabel: "お気に入りタブ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="heart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: "フレンド",
          tabBarAccessibilityLabel: "フレンドタブ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "プロフ",
          tabBarAccessibilityLabel: "プロフィールタブ",
          tabBarButtonTestID: "profile-tab-button",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
