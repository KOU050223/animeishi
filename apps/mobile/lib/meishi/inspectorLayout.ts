export function getInspectorHeight(windowHeight: number): number {
  return Math.min(
    480,
    Math.max(236, Math.round(windowHeight * 0.48)),
    Math.max(236, windowHeight - 332),
  );
}
