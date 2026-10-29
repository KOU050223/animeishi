import { useColorScheme } from "react-native";
import { colors } from "./colors";
import type { ThemeColors } from "./colors";

/**
 * 現在のカラースキームに対応するカラートークン一式を返す。
 *
 * 判定元は RN の `useColorScheme()`（= Appearance）で、`dark:` バリアントが
 * 有効になる条件と同じ。style prop・Ionicons・ActivityIndicator など JS 値
 * として色が必要な箇所で使う。className で書ける箇所は `dark:` バリアントを
 * 優先し、両方式が同じスキームを参照することをこのフックで担保する。
 */
export function useThemeColors(): ThemeColors {
  const colorScheme = useColorScheme();
  return colors[colorScheme === "dark" ? "dark" : "light"];
}
