const PUBLIC_ROUTES = new Set(["welcome", "privacy", "terms", "support"]);

export function shouldDeferRouteRender(
  segment: string | undefined,
  isLoaded: boolean,
): boolean {
  return (
    !PUBLIC_ROUTES.has(segment ?? "") &&
    (!isLoaded || typeof window === "undefined")
  );
}
