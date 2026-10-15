import { useColorScheme } from "nativewind";
import { colors } from "./colors";
import type { ThemeColors } from "./colors";

/**
 * 現在のカラースキームに対応するカラートークン一式を返す。
 *
 * 判定元は nativewind の `useColorScheme()` で、`dark:` バリアントが有効になる
 * 条件と同じ。style prop・Ionicons・ActivityIndicator など JS 値として色が
 * 必要な箇所で使う。NativeWind の className で書ける箇所は `dark:` バリアントを
 * 優先し、両方式が同じスキームを参照することをこのフックで担保する。
 */
export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return colors[colorScheme === "dark" ? "dark" : "light"];
}
