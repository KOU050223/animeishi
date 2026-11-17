export function guestLandingPath(
  segments: readonly string[],
): "/welcome" | null {
  return segments[0] === "(tabs)" && segments[1] === "(home)"
    ? "/welcome"
    : null;
}
