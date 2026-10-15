import { describe, expect, it } from "vitest";
import {
  ANNICT_FUNNEL_ATTRS,
  ANNICT_FUNNEL_EVENT,
  ANNICT_FUNNEL_STEPS,
  normalizeAnnictFunnelSurface,
} from "./funnel";

describe("normalizeAnnictFunnelSurface", () => {
  it("既知の surface をそのまま返す", () => {
    expect(normalizeAnnictFunnelSurface("watch_history")).toBe("watch_history");
    expect(normalizeAnnictFunnelSurface("profile_card")).toBe("profile_card");
  });

  it("未知値・未設定は undefined に倒す", () => {
    expect(normalizeAnnictFunnelSurface("admin_panel")).toBeUndefined();
    expect(normalizeAnnictFunnelSurface("")).toBeUndefined();
    expect(normalizeAnnictFunnelSurface(null)).toBeUndefined();
    expect(normalizeAnnictFunnelSurface(undefined)).toBeUndefined();
  });
});

describe("ファネル定数", () => {
  it("イベント名とステップが定義されている", () => {
    expect(ANNICT_FUNNEL_EVENT).toBe("annict_connect_funnel");
    expect(ANNICT_FUNNEL_STEPS).toEqual(["prompt_view", "cta_tap", "oauth_result"]);
  });

  it("属性キーは annict.* プレフィックスで衝突しない", () => {
    for (const key of Object.values(ANNICT_FUNNEL_ATTRS)) {
      expect(key).toMatch(/^annict\./);
    }
  });
});
