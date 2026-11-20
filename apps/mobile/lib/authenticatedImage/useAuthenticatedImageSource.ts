import type { UseAuthenticatedImageSource } from "./types";

/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./useAuthenticatedImageSource` の
 * 解決時に .native.ts / .web.ts を優先して読み込むため、実行時に
 * このファイルが評価されることは基本的にない。TypeScript が型を
 * 解決できるよう、シグネチャだけを宣言しておく。
 */
export const useAuthenticatedImageSource: UseAuthenticatedImageSource = () => {
  throw new Error(
    "useAuthenticatedImageSource: プラットフォーム実装が解決されていません",
  );
};
