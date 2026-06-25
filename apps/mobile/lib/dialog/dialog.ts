/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./dialog` の解決時に
 * dialog.native.ts / dialog.web.ts を優先して読み込むため、
 * 実行時にこのファイルが評価されることは基本的にない。
 * TypeScript が型を解決できるよう、シグネチャだけを宣言しておく。
 */
import type { AlertDialog, ConfirmDialog } from "./types";

export const alert: AlertDialog = () => {
  throw new Error("dialog.alert: プラットフォーム実装が解決されていません");
};

export const confirm: ConfirmDialog = () => {
  throw new Error("dialog.confirm: プラットフォーム実装が解決されていません");
};
