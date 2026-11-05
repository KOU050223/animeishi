import { SaveFormat } from "expo-image-manipulator";
import type { ImageOutputFormat } from "./types";

let cached: ImageOutputFormat | null = null;

// Web 版の expo-image-manipulator は canvas で書き出すため、ブラウザが
// WebP エンコードに対応していないと例外になる（iOS Safari 等。issue #468）。
// 対応状況は UA ではなく canvas の実際の出力で判定し、非対応なら JPEG に落とす。
// PNG にしないのは、名刺画像 API の 500KB 上限を写真で超えやすいため。
export function resolveImageOutputFormat(): ImageOutputFormat {
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const supportsWebp = canvas
    .toDataURL("image/webp")
    .startsWith("data:image/webp");
  cached = supportsWebp
    ? { format: SaveFormat.WEBP, mimeType: "image/webp" }
    : { format: SaveFormat.JPEG, mimeType: "image/jpeg" };
  return cached;
}

/** テスト用。判定結果のキャッシュを捨てる。 */
export function resetImageOutputFormatCache(): void {
  cached = null;
}
