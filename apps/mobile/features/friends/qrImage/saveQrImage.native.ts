import { shareTierListImage } from "@/lib/tierList/share";
import type { SaveQrImage } from "./types";

/**
 * iOS/Android: 画面上の QR カード View を view-shot で PNG 化し、OS の
 * 共有シートへ渡す。保存先（写真・ファイル等）はユーザーがシートで選ぶ。
 * 写真アプリへの直接保存には expo-media-library が要るが、新しいネイティブ
 * 依存を増やさないため共有シート経由にしている（issue #413）。
 * 対象の View は collapsable={false} で描画されていること
 * （Android で View がフラット化されると captureRef が失敗するため）。
 */
export const saveQrImage: SaveQrImage = (target, { title, backgroundColor }) =>
  shareTierListImage(target, { dialogTitle: title, backgroundColor });
