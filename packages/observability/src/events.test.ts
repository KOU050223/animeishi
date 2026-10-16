import { describe, expect, it } from "vitest";
import { TRACKED_EVENTS, TRACK_EVENT_ATTRS } from "./events";
import { EventRateLimiter } from "./rateLimit";

describe("TRACKED_EVENTS", () => {
  it("イベント名は一意で snake_case", () => {
    expect(new Set(TRACKED_EVENTS).size).toBe(TRACKED_EVENTS.length);
    for (const name of TRACKED_EVENTS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("共通属性キーは重複しない", () => {
    const values = Object.values(TRACK_EVENT_ATTRS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("EventRateLimiter", () => {
  it("上限までは許可し、超過分を拒否する", () => {
    const limiter = new EventRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(limiter.shouldAllow("event_a", 1_000)).toBe(true);
    }
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(false);
  });

  it("イベント名ごとに独立してカウントする", () => {
    const limiter = new EventRateLimiter(1, 60_000);
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(true);
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(false);
    expect(limiter.shouldAllow("event_b", 1_000)).toBe(true);
  });

  it("ウィンドウを過ぎた記録は数えない", () => {
    const limiter = new EventRateLimiter(1, 60_000);
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(true);
    expect(limiter.shouldAllow("event_a", 30_000)).toBe(false);
    // 61 秒後は最初の記録がウィンドウ外になるため再び許可される
    expect(limiter.shouldAllow("event_a", 62_000)).toBe(true);
  });

  it("reset でカウントを初期化する", () => {
    const limiter = new EventRateLimiter(1, 60_000);
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(true);
    limiter.reset();
    expect(limiter.shouldAllow("event_a", 1_000)).toBe(true);
  });
});
