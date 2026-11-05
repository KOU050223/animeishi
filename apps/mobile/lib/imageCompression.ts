import { ImageManipulator, type ImageResult } from "expo-image-manipulator";
import {
  resolveImageOutputFormat,
  type ImageOutputFormat,
} from "@/lib/imageOutputFormat";

/** アバター画像の最大辺の長さ（px）。これを超える画像は縮小される。 */
export const AVATAR_MAX_DIMENSION = 512;

/** 名刺アセット画像の最大辺の長さ（px）。名刺幅いっぱいに置いても粗くなりにくい 1024px。 */
export const MEISHI_IMAGE_MAX_DIMENSION = 1024;

export type ImageSize = { width: number; height: number };

/** 圧縮結果。アップロード時は mimeType をそのまま Content-Type に使う。 */
export type CompressedImage = ImageResult & {
  mimeType: ImageOutputFormat["mimeType"];
};

/**
 * 元画像の寸法から、最大辺を {@link AVATAR_MAX_DIMENSION} に収めたリサイズ後の寸法を計算する。
 * アスペクト比は保持する。元画像が既に十分小さい場合はそのままの寸法を返す（拡大はしない）。
 *
 * expo-image-manipulator に依存しない純粋関数なので、ロジックを単体テストできる。
 */
export function calcResizedSize(
  { width, height }: ImageSize,
  maxDimension: number = AVATAR_MAX_DIMENSION,
): ImageSize {
  const longestSide = Math.max(width, height);
  if (longestSide <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longestSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * 画像を最大 512px にリサイズし、WebP（非対応のブラウザでは JPEG）に圧縮する。
 * プロフィール画像アップロード前の前処理として使う。
 *
 * @param uri 元画像のローカル URI（ImagePicker の結果など）
 * @param source 元画像の寸法。ImagePicker の asset から取得して渡す。
 */
export async function compressAvatarImage(
  uri: string,
  source: ImageSize,
): Promise<CompressedImage> {
  const size = calcResizedSize(source);
  const { format, mimeType } = resolveImageOutputFormat();
  const image = await ImageManipulator.manipulate(uri)
    .resize(size)
    .renderAsync();
  const saved = await image.saveAsync({ format });
  return { ...saved, mimeType };
}

/**
 * 名刺の任意画像を最大 1024px の WebP（非対応のブラウザでは JPEG）に圧縮する。
 * API（POST /me/meishi-assets）の上限 500KB に収めやすくするため
 * compress: 0.8 を指定する（アバターは 512px のため既定値で足りていた）。
 */
export async function compressMeishiImage(
  uri: string,
  source: ImageSize,
): Promise<CompressedImage> {
  const size = calcResizedSize(source, MEISHI_IMAGE_MAX_DIMENSION);
  const { format, mimeType } = resolveImageOutputFormat();
  const image = await ImageManipulator.manipulate(uri)
    .resize(size)
    .renderAsync();
  const saved = await image.saveAsync({ format, compress: 0.8 });
  return { ...saved, mimeType };
}
