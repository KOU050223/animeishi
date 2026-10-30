import type { CardPressableProps } from "./types";

/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 * バンドラーは `./CardPressable` の解決時に CardPressable.native.tsx /
 * CardPressable.web.tsx を優先して読み込むため、実行時にこの実装が
 * 評価されることは基本的にない。
 */
export function CardPressable(_props: CardPressableProps): never {
  throw new Error("CardPressable: プラットフォーム実装が解決されていません");
}
