/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./profileUrl` の解決時に
 * profileUrl.native.ts / profileUrl.web.ts を優先して読み込む。
 */
import type { BuildProfileUrl } from "./types";

export const buildProfileUrl: BuildProfileUrl = () => {
  throw new Error("profileUrl: プラットフォーム実装が解決されていません");
};
