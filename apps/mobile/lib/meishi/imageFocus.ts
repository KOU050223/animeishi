import type { ImageElement } from "./types";

export type ImageFocus = NonNullable<ImageElement["focus"]>;
type Size = { width: number; height: number };
type Delta = { x: number; y: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function imageContentPosition(focus?: ImageFocus) {
  return {
    left: `${clamp01(focus?.x ?? 0.5) * 100}%`,
    top: `${clamp01(focus?.y ?? 0.5) * 100}%`,
  };
}

export function dragImageFocus(
  focus: ImageFocus | undefined,
  delta: Delta,
  frame: Size,
  image: Size,
): ImageFocus {
  if (
    frame.width <= 0 ||
    frame.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return focus ?? { x: 0.5, y: 0.5 };
  }
  const scale = Math.max(
    frame.width / image.width,
    frame.height / image.height,
  );
  const overflowX = image.width * scale - frame.width;
  const overflowY = image.height * scale - frame.height;
  return {
    x:
      overflowX > 0
        ? clamp01((focus?.x ?? 0.5) - delta.x / overflowX)
        : (focus?.x ?? 0.5),
    y:
      overflowY > 0
        ? clamp01((focus?.y ?? 0.5) - delta.y / overflowY)
        : (focus?.y ?? 0.5),
  };
}
