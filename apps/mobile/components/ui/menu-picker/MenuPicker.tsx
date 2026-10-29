import type { MenuPickerProps } from "./types";

/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * バンドラーは `./MenuPicker` の解決時に MenuPicker.native.tsx /
 * MenuPicker.web.tsx を優先して読み込むため、実行時にこの実装が
 * 評価されることは基本的にない。
 */
export function MenuPicker<T extends string | number>(
  _props: MenuPickerProps<T>,
): never {
  throw new Error("MenuPicker: プラットフォーム実装が解決されていません");
}
