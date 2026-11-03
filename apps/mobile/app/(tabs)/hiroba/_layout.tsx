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
