import { TouchableOpacity } from "react-native";
import type { CardPressableProps } from "./types";

export function CardPressable({
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
}: CardPressableProps) {
  return (
    <TouchableOpacity
      style={style}
      testID={testID}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </TouchableOpacity>
  );
}
