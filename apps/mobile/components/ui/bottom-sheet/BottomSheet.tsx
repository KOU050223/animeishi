import type { BottomSheetProps } from "./types";

/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * バンドラーは `./BottomSheet` の解決時に BottomSheet.native.tsx /
 * BottomSheet.web.tsx を優先して読み込むため、実行時にこの実装が
 * 評価されることは基本的にない。
 */
export function BottomSheet(_props: BottomSheetProps): never {
  throw new Error("BottomSheet: プラットフォーム実装が解決されていません");
}
