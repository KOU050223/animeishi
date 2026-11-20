import { describe, expect, it } from "vitest";

import {
  createProximityHaptics,
  HAPTIC_PULSE_INTERVAL_MS,
  proximityLevel,
} from "./proximityLevel";

describe("proximityLevel", () => {
  it("10cm 以下は touch（交換成立）", () => {
    expect(proximityLevel(0.1)).toBe("touch");
    expect(proximityLevel(0.05)).toBe("touch");
  });

  it("20cm 以下は close", () => {
    expect(proximityLevel(0.2)).toBe("close");
    expect(proximityLevel(0.11)).toBe("close");
  });

  it("50cm 以下は near", () => {
    expect(proximityLevel(0.5)).toBe("near");
    expect(proximityLevel(0.21)).toBe("near");
  });

  it("50cm より遠い、または未測定は far", () => {
    expect(proximityLevel(0.51)).toBe("far");
    expect(proximityLevel(null)).toBe("far");
  });
});

describe("createProximityHaptics", () => {
  it("near では一定間隔で light を返す", () => {
    const h = createProximityHaptics();
    expect(h.next(0.4, 0)).toBe("light");
    expect(h.next(0.4, HAPTIC_PULSE_INTERVAL_MS - 1)).toBe("none");
    expect(h.next(0.4, HAPTIC_PULSE_INTERVAL_MS)).toBe("light");
  });

  it("close では一定間隔で medium を返す", () => {
    const h = createProximityHaptics();
    expect(h.next(0.15, 0)).toBe("medium");
    expect(h.next(0.15, HAPTIC_PULSE_INTERVAL_MS - 1)).toBe("none");
    expect(h.next(0.15, HAPTIC_PULSE_INTERVAL_MS)).toBe("medium");
  });

  it("touch への突入で strong を 1 回だけ返す", () => {
    const h = createProximityHaptics();
    expect(h.next(0.09, 0)).toBe("strong");
    expect(h.next(0.09, HAPTIC_PULSE_INTERVAL_MS * 10)).toBe("none");
  });

  it("touch を外れると再武装され、再度の突入で strong を返す", () => {
    const h = createProximityHaptics();
    expect(h.next(0.09, 0)).toBe("strong");
    // touch を外れて close に戻ると再武装され、引き離す途中も medium が鳴る
    expect(h.next(0.15, 10)).toBe("medium");
    expect(h.next(0.09, 20)).toBe("strong");
  });

  it("far では鳴らさない", () => {
    const h = createProximityHaptics();
    expect(h.next(0.8, 0)).toBe("none");
    expect(h.next(null, 100)).toBe("none");
  });
});
