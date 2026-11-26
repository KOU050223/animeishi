import type { SelectionAccessibilityProps } from "./types";

// React Native Web は accessibilityState.selected を DOM に出さないため、
// Web ではトグルボタンの aria-pressed として選択状態を出す（issue #809）。
export function selectionAccessibilityProps(
  selected: boolean,
): SelectionAccessibilityProps {
  return { "aria-pressed": selected };
}
