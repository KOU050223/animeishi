import { Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/lib/theme";

export type BackButtonProps = {
  onPress: () => void;
  /** 読み上げ用の文言（例: "戻る"）。必ず呼び出し側が渡す。 */
  accessibilityLabel: string;
  testID?: string;
  /** 周囲の余白・配置の調整（NativeWind の className）。 */
  className?: string;
  /** StyleSheet ベースの画面で使う配置調整。 */
  style?: StyleProp<ViewStyle>;
};

/**
 * 「戻る」導線のアイコンボタン（issue #351）。文言を持たず Ionicons の
 * chevron-back で表すため、意味は accessibilityLabel で必ず伝える。
 */
export function BackButton({
  onPress,
  accessibilityLabel,
  testID,
  className,
  style,
}: BackButtonProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={className}
      style={[styles.hitbox, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Ionicons name="chevron-back" size={28} color={colors.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // iOS HIG の最小タップ領域（44x44pt）を確保する。狭くすると
  // アイコンより押しにくいボタンに戻ってしまう。
  hitbox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
