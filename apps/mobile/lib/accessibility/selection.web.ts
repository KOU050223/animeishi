import type {
  CurrentAccessibilityProps,
  SelectionAccessibilityProps,
} from "./types";

// React Native Web は accessibilityState.selected を DOM に出さないため、
// Web ではトグルボタンの aria-pressed として選択状態を出す（issue #809）。
export function selectionAccessibilityProps(
  selected: boolean,
): SelectionAccessibilityProps {
  return { "aria-pressed": selected };
}

// 並び替えキーのように押しても選択状態そのものはトグルしない現在値は、
// トグルボタン用の aria-pressed ではなく aria-current で表す。
export function currentAccessibilityProps(
  current: boolean,
): CurrentAccessibilityProps {
  return { "aria-current": current };
}
