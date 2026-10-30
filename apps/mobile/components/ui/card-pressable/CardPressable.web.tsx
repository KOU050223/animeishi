import { TouchableOpacity } from "react-native";
import type { CardPressableProps } from "./types";

// react-native-web は accessibilityRole="button" を実際の <button> 要素に
// 変換する。子に別のボタンを含むカードが <button> になると DOM として無効
// （<button> 内に <button> を置けない）ため、Web では role=group の div に
// 落とす。押下はポインタと Enter キーのどちらでも効く。
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
      role="group"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </TouchableOpacity>
  );
}
