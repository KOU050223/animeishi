import { describe, expect, it } from "vitest";
import { GUEST_CTA_SOURCES, normalizeGuestCtaSource } from "./guestCta";

describe("normalizeGuestCtaSource", () => {
  it("既知の入口をそのまま返す", () => {
    for (const source of GUEST_CTA_SOURCES) {
      expect(normalizeGuestCtaSource(source)).toBe(source);
    }
  });

  it("未知値・未設定は undefined に倒す", () => {
    expect(normalizeGuestCtaSource("share_unknown")).toBeUndefined();
    expect(normalizeGuestCtaSource("")).toBeUndefined();
    expect(normalizeGuestCtaSource(null)).toBeUndefined();
    expect(normalizeGuestCtaSource(undefined)).toBeUndefined();
  });
});
