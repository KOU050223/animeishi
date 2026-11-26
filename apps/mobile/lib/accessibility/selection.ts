/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * 実行時は selection.native.ts / selection.web.ts が解決される。
 */
import type {
  CurrentAccessibilityProps,
  SelectionAccessibilityProps,
} from "./types";

export function selectionAccessibilityProps(
  _selected: boolean,
): SelectionAccessibilityProps {
  throw new Error(
    "selectionAccessibilityProps: プラットフォーム実装が解決されていません",
  );
}

export function currentAccessibilityProps(
  _current: boolean,
): CurrentAccessibilityProps {
  throw new Error(
    "currentAccessibilityProps: プラットフォーム実装が解決されていません",
  );
}
