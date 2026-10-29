import type { GroupedListProps } from "./types";

/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * バンドラーは `./GroupedList` の解決時に GroupedList.native.tsx /
 * GroupedList.web.tsx を優先して読み込むため、実行時にこの実装が
 * 評価されることは基本的にない。
 */
export function GroupedList(_props: GroupedListProps): never {
  throw new Error("GroupedList: プラットフォーム実装が解決されていません");
}
