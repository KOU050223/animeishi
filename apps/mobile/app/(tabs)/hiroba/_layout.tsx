import { Platform } from "react-native";
import { Stack } from "expo-router";
import { useStackHeaderOptions } from "@/lib/theme/stackHeaderOptions";
import { useThemeColors } from "@/lib/theme";

/**
 * ひろばタブ内のネスト Stack（issue #352）。
 * ライブラリ・QR・フレンドと同じく、タブルート画面は large title にする。
 */
export default function HirobaLayout() {
  const colors = useThemeColors();
  const headerOptions = useStackHeaderOptions();

  return (
    <Stack
      screenOptions={{
        ...headerOptions,
        // Android のヘッダーは不透明で headerStyle 未指定だとテーマの
        // card 色（ダークで #121212）になり、本文の colors.background と
        // 食い違う。iOS ではブラーが消えるので指定しない（issue #491）。
        headerStyle:
          Platform.OS === "android"
            ? { backgroundColor: colors.background }
            : undefined,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "ひろば", headerLargeTitle: true }}
      />
    </Stack>
  );
}
