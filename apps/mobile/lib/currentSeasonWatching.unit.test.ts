import { describe, expect, it } from "vitest";
import type { WatchState } from "@/lib/watchStatusLabels";
import { filterCurrentSeasonWatching } from "./currentSeasonWatching";

// 2026-11-03 は JST で 2026-autumn 期。
const NOW = new Date("2026-11-03T00:00:00+09:00");

const entry = (state: WatchState, seasonName: string | null) => ({
  state,
  seasonName,
});

describe("filterCurrentSeasonWatching", () => {
  it("今期かつ WATCHING の作品だけを返す", () => {
    const items = [
      entry("WATCHING", "2026-autumn"),
      entry("WATCHED", "2026-autumn"),
      entry("WATCHING", "2026-summer"),
      entry("WANNA_WATCH", "2026-autumn"),
      entry("ON_HOLD", "2026-autumn"),
    ];
    expect(filterCurrentSeasonWatching(items, NOW)).toEqual([
      entry("WATCHING", "2026-autumn"),
    ]);
  });

  it("seasonName の fall 表記も autumn として今期に数える", () => {
    const items = [entry("WATCHING", "2026-fall")];
    expect(filterCurrentSeasonWatching(items, NOW)).toEqual([
      entry("WATCHING", "2026-fall"),
    ]);
  });

  it("seasonName が無い作品は今期に数えない", () => {
    expect(filterCurrentSeasonWatching([entry("WATCHING", null)], NOW)).toEqual(
      [],
    );
  });
});
