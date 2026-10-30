import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * 子にボタンを含められる押下可能なコンテナの共通インターフェース。
 *
 * 実装は拡張子分割で切り替わる:
 * - CardPressable.native.tsx ... iOS/Android（TouchableOpacity + accessibilityRole=button）
 * - CardPressable.web.tsx    ... Web（<button> の中に <button> を置けないため
 *                                accessibilityRole を付けない div に落とす）
 *
 * 呼び出し側は常に `@/components/ui/card-pressable` から import する。
 */
export type CardPressableProps = {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  /** コンテナ自体のアクセシビリティラベル（「{title}の詳細を開く」等）。 */
  accessibilityLabel: string;
  testID?: string;
};
