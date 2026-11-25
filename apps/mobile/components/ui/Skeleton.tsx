import { useEffect } from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/lib/theme";

// パルスは「待機中である」ことが分かる最低限の強さに抑える（往復 2.2 秒）。
const PULSE_MS = 1100;
const PULSE_TO = 0.55;

/**
 * スケルトンの骨 1 本。色はテーマトークン（colors.skeleton /
 * skeletonMuted）を使い、副行など一段薄い骨は muted で切り替える。
 * パルス・アクセシビリティの面倒は SkeletonGroup 側が見るため、
 * 骨だけを画面に置かず SkeletonGroup で囲って使う。
 */
export function Skeleton({
  className,
  style,
  muted = false,
  testID,
}: {
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** 副テキスト行など、一段薄く見せたい骨に付ける。 */
  muted?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      // nativewind の className は省略可能プロパティなので、未指定時は
      // キーごと渡さない（exactOptionalPropertyTypes 対応）。
      {...(className !== undefined ? { className } : {})}
      style={[
        { backgroundColor: muted ? colors.skeletonMuted : colors.skeleton },
        style,
      ]}
      testID={testID}
    />
  );
}

/**
 * スケルトン領域のラッパー。領域ごとに 1 つのパルスアニメーションを
 * 持たせ、骨ごとに別々のアニメーションを立ち上げない（骨がずれて
 * 脈打つと目障りなため）。reduce motion 設定時はパルスを止める。
 *
 * accessibilityLabel を渡すと領域全体が 1 つの busy な要素になり、
 * 「読み込み中」が 1 回だけ読み上げられる。既に別の読み込み領域が
 * ラベルを持つ画面内の部分的な領域（詳細シート内のセクション等）では
 * ラベルを付けず、読み上げが重複しないようにする。
 */
export function SkeletonGroup({
  accessibilityLabel,
  className,
  style,
  testID,
  children,
}: {
  /** 指定すると領域を 1 つの読み込み中要素として読み上げ対象にする。 */
  accessibilityLabel?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    // SharedValue の書き込みは .set() を使う（.value への代入は
    // React Compiler 系 lint の react/immutability に引っかかる）。
    pulse.set(
      withRepeat(withTiming(PULSE_TO, { duration: PULSE_MS }), -1, true),
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      {...(className !== undefined ? { className } : {})}
      style={[style, pulseStyle]}
      {...(accessibilityLabel !== undefined
        ? {
            accessible: true,
            accessibilityLabel,
            accessibilityState: { busy: true },
          }
        : {})}
      testID={testID}
    >
      {children}
    </Animated.View>
  );
}
