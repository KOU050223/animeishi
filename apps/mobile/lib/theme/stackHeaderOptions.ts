import type { ComponentProps } from "react";
import type { Stack } from "expo-router";
import { useThemeColors } from "./useThemeColors";

// screenOptions はコールバック形式も取れる union 型のため、
// オブジェクト側だけを取り出す（spread 可能にする）。
type StackScreenOptions = Exclude<
  ComponentProps<typeof Stack>["screenOptions"],
  undefined | ((props: never) => object)
>;

/**
 * ネイティブヘッダー化（issue #395 Phase 2）で各 Stack に共通の
 * ヘッダーオプション。tint・タイトル色をテーマトークンに揃え、
 * ヘッダー下の影は切る（画面背景との境界は不要なため）。
 * headerStyle を指定すると iOS 純正のブラーが消えるため設定しない。
 */
export function useStackHeaderOptions(): StackScreenOptions {
  const colors = useThemeColors();
  return {
    headerTintColor: colors.primaryText,
    headerTitleStyle: { color: colors.text },
    headerShadowVisible: false,
  };
}
