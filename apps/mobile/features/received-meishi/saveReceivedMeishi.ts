import type { SaveReceivedMeishi } from "./types";

// 拡張子分割のフォールバック兼・型定義の集約点。
export const saveReceivedMeishi: SaveReceivedMeishi = () => {
  throw new Error("receivedMeishi: プラットフォーム実装が解決されていません");
};
