/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./passkey` の解決時に
 * passkey.native.ts / passkey.web.ts を優先して読み込むため、
 * 実行時にこのファイルが評価されることは基本的にない。
 * TypeScript が型を解決できるよう、シグネチャだけを宣言しておく。
 */
export const passkey: boolean = (() => {
  throw new Error(
    "featureFlags.passkey: プラットフォーム実装が解決されていません",
  );
})();
