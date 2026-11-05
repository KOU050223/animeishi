import { SaveFormat } from "expo-image-manipulator";
import type { ImageOutputFormat } from "./types";

export function resolveImageOutputFormat(): ImageOutputFormat {
  return { format: SaveFormat.WEBP, mimeType: "image/webp" };
}
