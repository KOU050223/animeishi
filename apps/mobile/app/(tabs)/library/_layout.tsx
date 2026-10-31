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
