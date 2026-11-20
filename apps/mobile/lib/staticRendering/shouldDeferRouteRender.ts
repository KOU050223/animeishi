export function shouldDeferRouteRender(
  _segment: string | undefined,
  _isLoaded: boolean,
): boolean {
  throw new Error("Platform implementation required");
}
