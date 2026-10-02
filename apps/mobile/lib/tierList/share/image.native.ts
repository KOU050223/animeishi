import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import type { ShareTierListImage } from "./types";

/**
 * iOS/Android: 画面外にレンダリングしたスナップショット View を PNG 化し、
 * OS の共有シートへ渡す。対象の View は collapsable={false} で描画されている
 * こと（Android で View がフラット化されると captureRef が失敗するため）。
 */
export const shareTierListImage: ShareTierListImage = async (
  target,
  { dialogTitle },
) => {
  const uri = await captureRef(target, { format: "png", quality: 1 });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("この端末では共有を利用できません");
  }
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle });
};
