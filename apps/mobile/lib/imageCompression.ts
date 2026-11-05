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

/** 名刺画像 API（POST /me/meishi-assets）が受け付ける最大バイト数。API の MEISHI_ASSET_MAX_BYTES と揃える。 */
export const MEISHI_IMAGE_MAX_BYTES = 500 * 1024;

// 上限を超えたときに順に試す（最大辺, 品質）。最初の 1 件がこれまでの既定値。
// WebP 非対応ブラウザの JPEG は同じ品質でも WebP より大きくなりやすいため、
// 1 回の保存で済ませず実サイズを見て段階的に落とす（issue #468）。
const MEISHI_IMAGE_ATTEMPTS: readonly {
  maxDimension: number;
  compress: number;
}[] = [
  { maxDimension: MEISHI_IMAGE_MAX_DIMENSION, compress: 0.8 },
  { maxDimension: MEISHI_IMAGE_MAX_DIMENSION, compress: 0.6 },
  { maxDimension: 768, compress: 0.6 },
  { maxDimension: 512, compress: 0.6 },
];

async function readByteLength(uri: string): Promise<number> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return blob.size;
}

/**
 * 名刺の任意画像を最大 1024px の WebP（非対応のブラウザでは JPEG）に圧縮する。
 * 保存結果が API の上限 {@link MEISHI_IMAGE_MAX_BYTES} を超えるときは、
 * 品質・寸法を下げて保存し直す。最後まで収まらなければ最後の結果を返し、
 * 上限超過のエラーはアップロード側（API の 400）に任せる。
 */
export async function compressMeishiImage(
  uri: string,
  source: ImageSize,
): Promise<CompressedImage> {
  const { format, mimeType } = resolveImageOutputFormat();
  let saved: ImageResult | null = null;
  for (const attempt of MEISHI_IMAGE_ATTEMPTS) {
    const size = calcResizedSize(source, attempt.maxDimension);
    const image = await ImageManipulator.manipulate(uri)
      .resize(size)
      .renderAsync();
    saved = await image.saveAsync({ format, compress: attempt.compress });
    if ((await readByteLength(saved.uri)) <= MEISHI_IMAGE_MAX_BYTES) break;
  }
  // MEISHI_IMAGE_ATTEMPTS は空でないので saved は必ず埋まる。
  return { ...(saved as ImageResult), mimeType };
}
