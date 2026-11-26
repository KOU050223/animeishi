import type {
  CurrentAccessibilityProps,
  SelectionAccessibilityProps,
} from "./types";

// iOS/Android は accessibilityState.selected が支援技術に伝わるため追加属性は不要。
export function selectionAccessibilityProps(
  _selected: boolean,
): SelectionAccessibilityProps {
  return {};
}

export function currentAccessibilityProps(
  _current: boolean,
): CurrentAccessibilityProps {
  return {};
}
