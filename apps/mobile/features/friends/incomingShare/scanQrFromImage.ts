/**
 * 拡張子分割のフォールバック兼・型定義の集約点。
 *
 * バンドラー (Metro / webpack) は `./scanQrFromImage` の解決時に
 * scanQrFromImage.native.ts を優先して読み込む。
 */
import type { ScanQrFromImage } from "./types";

export const scanQrFromImage: ScanQrFromImage = () => {
  throw new Error("scanQrFromImage: プラットフォーム実装が解決されていません");
};
