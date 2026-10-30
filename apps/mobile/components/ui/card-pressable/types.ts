import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * 子にボタンを含められる押下可能なコンテナの共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - CardPressable.native.tsx ... iOS/Android（TouchableOpacity + accessibilityRole=button）
 * - CardPressable.web.tsx    ... Web（<button> の中に <button> を置けないため、
 *                                透明なオーバーレイ <button> を子要素と兄弟にする）
 *
 * 呼び出し側は常に `@/components/ui/card-pressable` から import する。
 */
export type CardPressableProps = {
  children: ReactNode;
  onPress: () => void;
  /** カード本体の見た目（背景・枠・角丸・padding 等）。 */
  style?: StyleProp<ViewStyle>;
  /**
   * Web 専用。カード内のコンテンツを並べるラッパー View のスタイル。
   * Web では子要素を包む中間 View が入るため、カードの並び方向
   * （flexDirection・gap 等）をこちらで指定する。native では使われない。
   */
  contentStyle?: StyleProp<ViewStyle>;
  /** コンテナ自体のアクセシビリティラベル（「{title}の詳細を開く」等）。 */
  accessibilityLabel: string;
  testID?: string;
};
