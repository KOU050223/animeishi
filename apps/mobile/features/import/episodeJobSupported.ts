/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./episodeJobSupported` の解決時に
 * episodeJobSupported.native.ts / episodeJobSupported.web.ts を優先して
 * 読み込むため、実行時にこのファイルが評価されることは基本的にない。
 * TypeScript が型を解決できるよう、シグネチャだけを宣言しておく。
 */
export const episodeJobSupported: boolean = (() => {
  throw new Error(
    "danime.episodeJobSupported: プラットフォーム実装が解決されていません",
  );
})();
