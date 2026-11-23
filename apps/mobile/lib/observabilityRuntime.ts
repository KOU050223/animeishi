/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro) は `./observabilityRuntime` の解決時に
 * observabilityRuntime.native.ts / observabilityRuntime.web.ts を
 * 優先して読み込むため、実行時にこのファイルが評価されることはない。
 * TypeScript が型を解決できるよう、シグネチャだけを宣言しておく。
 */
export function resolveRuntime(): string {
  throw new Error("resolveRuntime: プラットフォーム実装が解決されていません");
}
