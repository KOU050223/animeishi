import { Stack } from "expo-router";
import { useStackHeaderOptions } from "@/lib/theme/stackHeaderOptions";
import { useThemeColors } from "@/lib/theme";

/**
 * ホームタブ内のネスト Stack。タブルート画面は large title、
 * 以深の画面は通常タイトルにする（issue #395 Phase 2）。
 */
export default function HomeLayout() {
  const colors = useThemeColors();
  const headerOptions = useStackHeaderOptions();

  return (
    <Stack
      screenOptions={{
        ...headerOptions,
        contentStyle: { backgroundColor: colors.backgroundMuted },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "ホーム", headerLargeTitle: true }}
      />
    </Stack>
  );
}
