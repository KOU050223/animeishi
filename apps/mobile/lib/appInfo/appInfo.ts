/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./appInfo` の解決時に
 * appInfo.native.ts / appInfo.web.ts を優先して読み込むため、
 * 実行時にこのファイルが評価されることは基本的にない。
 * TypeScript が型を解決できるよう、シグネチャだけを宣言しておく。
 */
import type { GetAppInfo } from "./types";

export const getAppInfo: GetAppInfo = () => {
  throw new Error(
    "appInfo.getAppInfo: プラットフォーム実装が解決されていません",
  );
};
