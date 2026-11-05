import { Platform } from "react-native";
import { Stack } from "expo-router";
import { useStackHeaderOptions } from "@/lib/theme/stackHeaderOptions";
import { useThemeColors } from "@/lib/theme";

/**
 * ライブラリタブ内のネスト Stack（issue #395 Phase 2）。
 * ホームタブと同じく、タブルート画面は large title にする。
 */
export default function LibraryLayout() {
  const colors = useThemeColors();
  const headerOptions = useStackHeaderOptions();

  return (
    <Stack
      screenOptions={{
        ...headerOptions,
        // Android のヘッダーは不透明で headerStyle 未指定だとテーマの
        // card 色（ダークで #121212）になり、本文の colors.background と
        // 食い違う。iOS ではブラーが消えるので指定しない（issue #469）。
        headerStyle:
          Platform.OS === "android"
            ? { backgroundColor: colors.background }
            : undefined,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "ライブラリ", headerLargeTitle: true }}
      />
    </Stack>
  );
}
