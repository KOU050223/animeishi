import type { SaveFormat } from "expo-image-manipulator";

/** 圧縮画像の書き出し形式と、アップロード時に付ける Content-Type。 */
export type ImageOutputFormat = {
  format: SaveFormat;
  mimeType: "image/webp" | "image/jpeg";
};
