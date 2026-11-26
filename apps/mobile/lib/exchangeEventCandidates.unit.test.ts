import { describe, it, expect } from "vitest";
import {
  rankEventCandidates,
  isNearbyEvent,
  type EventCandidate,
} from "@/lib/exchangeEventCandidates";

const candidate = (
  slug: string,
  location: string | null,
  startsAt = "2026-11-20T00:00:00.000Z",
  endsAt = "2026-11-22T00:00:00.000Z",
): EventCandidate => ({
  slug,
  title: `イベント ${slug}`,
  location,
  startsAt,
  endsAt,
});

const NOW = new Date("2026-11-21T12:00:00.000Z");

describe("rankEventCandidates", () => {
  it("当日開催中のイベントだけを候補に残す", () => {
    const events = [
      candidate("today", null),
      candidate(
        "past",
        null,
        "2026-11-01T00:00:00.000Z",
        "2026-11-10T00:00:00.000Z",
      ),
      candidate(
        "future",
        null,
        "2026-12-01T00:00:00.000Z",
        "2026-12-02T00:00:00.000Z",
      ),
    ];
    const ranked = rankEventCandidates(events, { now: NOW });
    expect(ranked.map((e) => e.slug)).toEqual(["today"]);
  });

  it("場所が近いイベントを先頭にし、当日イベントは後ろに残す", () => {
    const events = [
      candidate("far", "幕張メッセ"),
      candidate("near", "東京ビッグサイト"),
      candidate("no-location", null),
    ];
    const ranked = rankEventCandidates(events, {
      now: NOW,
      placeName: "東京ビッグサイト東棟",
    });
    expect(ranked.map((e) => e.slug)).toEqual(["near", "far", "no-location"]);
    expect(ranked[0]?.nearby).toBe(true);
    expect(ranked[1]?.nearby).toBe(false);
    // 当日イベントは優先度を下げても候補から外さない（issue #661）
    expect(ranked).toHaveLength(3);
  });

  it("場所が解決できていないときは元の並びを保つ", () => {
    const events = [
      candidate("a", "東京ビッグサイト"),
      candidate("b", "幕張メッセ"),
    ];
    const ranked = rankEventCandidates(events, { now: NOW });
    expect(ranked.map((e) => e.slug)).toEqual(["a", "b"]);
    expect(ranked.every((e) => !e.nearby)).toBe(true);
  });
});

describe("isNearbyEvent", () => {
  it("包含関係（どちらかがどちらかを含む）で近さを判定する", () => {
    expect(isNearbyEvent("東京ビッグサイト", "東京ビッグサイト東棟")).toBe(
      true,
    );
    expect(isNearbyEvent("Tokyo Big Sight", "tokyo big sight 東7")).toBe(true);
    expect(isNearbyEvent("幕張メッセ", "東京ビッグサイト")).toBe(false);
    expect(isNearbyEvent(null, "幕張メッセ")).toBe(false);
    expect(isNearbyEvent("幕張メッセ", null)).toBe(false);
  });
});
