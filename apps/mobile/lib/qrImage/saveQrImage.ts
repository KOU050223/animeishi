import type { SaveQrImage } from "./types";

// 拡張子分割のフォールバック兼・型定義の集約点。
export const saveQrImage: SaveQrImage = () => {
  throw new Error("qrImage: プラットフォーム実装が解決されていません");
};
