export function getInspectorHeight(windowHeight: number): number {
  return Math.min(
    480,
    Math.max(236, Math.round(windowHeight * 0.48)),
    Math.max(236, windowHeight - 332),
  );
}

export function getFittedCanvasWidth(
  areaWidth: number,
  areaHeight: number,
  inspectorHeight: number,
  aspectRatio: number,
): number {
  return Math.max(
    0,
    Math.min(
      areaWidth - 24,
      560,
      (areaHeight - inspectorHeight - 24) * aspectRatio,
    ),
  );
}
