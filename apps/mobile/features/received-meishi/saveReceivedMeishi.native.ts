import { shareTierListImage } from "@/features/tier-lists/share";
import type { SaveReceivedMeishi } from "./types";

/**
 * iOS/Android: 画面に表示した名刺画像の View を view-shot で PNG 化し、
 * OS の共有シートへ渡す（保存先はユーザーがシートで選ぶ）。
 * URL からの直接ダウンロードには expo-file-system が要るが、新しい
 * ネイティブ依存を増やさないため表示済みの画像を撮る方式にしている
 * （saveQrImage.native.ts と同じ方針）。
 * 対象の View は collapsable={false} で描画されていること。
 */
export const saveReceivedMeishi: SaveReceivedMeishi = ({ target, title }) =>
  shareTierListImage(target, {
    dialogTitle: title,
    backgroundColor: "#ffffff",
  });
