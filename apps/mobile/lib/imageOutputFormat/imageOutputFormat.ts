import type { ImageOutputFormat } from "./types";

export function resolveImageOutputFormat(): ImageOutputFormat {
  throw new Error(
    "resolveImageOutputFormat is not implemented on this platform",
  );
}
