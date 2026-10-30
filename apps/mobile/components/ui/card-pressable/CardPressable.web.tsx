import { StyleSheet, TouchableOpacity, View } from "react-native";
import type { CardPressableProps } from "./types";

// react-native-web は accessibilityRole="button" を実際の <button> 要素に
// 変換する。<button> は他のボタンを子に持てないため、Web では
// 「カード全体に重なる透明な <button>」を最下層に敷き、コンテンツを
// pointer-events:none のラッパーで上に重ねる構造にする。
// ポスター・タイトル等のクリックは透過して下の <button> に届く。
// 子の中の押せるボタン（お気に入り等）は、呼び出し側が
// pointerEvents="auto" の View で包んでイベントを復活させる。
export function CardPressable({
  children,
  onPress,
  style,
  contentStyle,
  accessibilityLabel,
  testID,
}: CardPressableProps) {
  return (
    <View style={style}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
      <View pointerEvents="none" style={contentStyle}>
        {children}
      </View>
    </View>
  );
}
