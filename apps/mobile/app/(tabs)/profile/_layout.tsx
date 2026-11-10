import { Platform } from "react-native";
import { Stack } from "expo-router";
import { useStackHeaderOptions } from "@/lib/theme/stackHeaderOptions";
import { useThemeColors } from "@/lib/theme";

/**
 * プロフィールタブ内のネスト Stack（issue #395 Phase 2）。
 * ホームタブと同じく、タブルート画面は large title にする。
 */
export default function ProfileLayout() {
  const colors = useThemeColors();
  const headerOptions = useStackHeaderOptions();

  return (
    <Stack
      screenOptions={{
        ...headerOptions,
        // Android のヘッダーは不透明で headerStyle 未指定だとテーマの
        // card 色（ダークで #121212）になり、本文の colors.backgroundMuted と
        // 食い違う。iOS ではブラーが消えるので指定しない（issue #491）。
        headerStyle:
          Platform.OS === "android"
            ? { backgroundColor: colors.backgroundMuted }
            : undefined,
        contentStyle: { backgroundColor: colors.backgroundMuted },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "プロフィール", headerLargeTitle: true }}
      />
    </Stack>
  );
}
