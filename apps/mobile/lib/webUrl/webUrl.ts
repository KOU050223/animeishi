/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./webUrl` の解決時に
 * webUrl.native.ts / webUrl.web.ts を優先して読み込む。
 * 実行時にこのファイルが評価されることは基本的にない。
 */
export const webUrl: string = (() => {
  throw new Error("webUrl: プラットフォーム実装が解決されていません");
})();
