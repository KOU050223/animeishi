import { describe, expect, it } from "vitest";
import { guestLandingPath as webGuestLandingPath } from "./guestLandingRoute.web";
import { guestLandingPath as nativeGuestLandingPath } from "./guestLandingRoute.native";

describe("guest landing route", () => {
  it("sends an unauthenticated web root to the separate welcome URL", () => {
    expect(webGuestLandingPath(["(tabs)", "(home)"])).toBe("/welcome");
    expect(webGuestLandingPath([])).toBeNull();
  });

  it("keeps protected web paths on the sign-in flow", () => {
    expect(webGuestLandingPath(["(tabs)", "profile"])).toBeNull();
  });

  it("does not change native guest routing", () => {
    expect(nativeGuestLandingPath([])).toBeNull();
  });
});
