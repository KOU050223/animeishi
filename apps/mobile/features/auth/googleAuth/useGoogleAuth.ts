import type { UseGoogleAuth } from "./types";

/**
 * 拡張子分割のフォールバック。
 * 実行時には useGoogleAuth.native.ts / useGoogleAuth.web.ts が読み込まれるため
 * このファイルが評価されることはない（型解決のための宣言）。
 */
export const useGoogleAuth: UseGoogleAuth = () => {
  throw new Error("useGoogleAuth: プラットフォーム実装が解決されていません");
};
