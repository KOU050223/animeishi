import { TouchableOpacity } from "react-native";
import type { CardPressableProps } from "./types";

export function CardPressable({
  children,
  onPress,
  style,
  accessibilityLabel,
  testID,
}: CardPressableProps) {
  return (
    <TouchableOpacity
      style={style}
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </TouchableOpacity>
  );
}
