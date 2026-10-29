import { describe, expect, it } from "vitest";
import type { WatchState } from "./watchStatusLabels";
import {
  NO_WATCH_HISTORY_FILTERS,
  collectWatchHistoryDecades,
  filterWatchHistory,
  isWatchHistoryFilterActive,
  sortWatchHistory,
  yearToDecade,
} from "./watchHistorySortFilter";

function entry(
  annictWorkId: number,
  overrides: Partial<{
    state: WatchState;
    seasonYear: number | null;
    watchersCount: number | null;
  }> = {},
) {
  return {
    annictWorkId,
    state: "WATCHED" as WatchState,
    seasonYear: 2024,
    watchersCount: 100,
    ...overrides,
  };
}

describe("yearToDecade", () => {
  it("放送年を年代の先頭年に丸める", () => {
    expect(yearToDecade(2024)).toBe(2020);
    expect(yearToDecade(2020)).toBe(2020);
    expect(yearToDecade(1999)).toBe(1990);
  });
});

describe("collectWatchHistoryDecades", () => {
  it("出現する年代だけを新しい順に並べる", () => {
    const items = [
      entry(1, { seasonYear: 1998 }),
      entry(2, { seasonYear: 2024 }),
      entry(3, { seasonYear: 2021 }),
      entry(4, { seasonYear: 2013 }),
    ];
    expect(collectWatchHistoryDecades(items)).toEqual([2020, 2010, 1990]);
  });

  it("放送年が未設定の作品があるときだけ unknown を末尾に足す", () => {
    expect(
      collectWatchHistoryDecades([
        entry(1, { seasonYear: 2024 }),
        entry(2, { seasonYear: null }),
      ]),
    ).toEqual([2020, "unknown"]);
    expect(collectWatchHistoryDecades([entry(1)])).toEqual([2020]);
  });
});

describe("isWatchHistoryFilterActive", () => {
  it("年代も状態も未指定なら無効", () => {
    expect(isWatchHistoryFilterActive(NO_WATCH_HISTORY_FILTERS)).toBe(false);
  });

  it("年代または状態を指定していれば有効", () => {
    expect(isWatchHistoryFilterActive({ decade: 2020, states: [] })).toBe(true);
    expect(
      isWatchHistoryFilterActive({ decade: null, states: ["WATCHING"] }),
    ).toBe(true);
  });
});

describe("filterWatchHistory", () => {
  const items = [
    entry(1, { state: "WATCHING", seasonYear: 2024 }),
    entry(2, { state: "WATCHED", seasonYear: 2013 }),
    entry(3, { state: "WANNA_WATCH", seasonYear: 2021 }),
    entry(4, { state: "WATCHED", seasonYear: null }),
  ];

  it("フィルタ無効時はすべて返す", () => {
    expect(filterWatchHistory(items, NO_WATCH_HISTORY_FILTERS)).toEqual(items);
  });

  it("年代で絞り込む（同じ年代の別年も含む）", () => {
    const result = filterWatchHistory(items, {
      decade: 2020,
      states: [],
    });
    expect(result.map((e) => e.annictWorkId)).toEqual([1, 3]);
  });

  it('decade="unknown" は放送年未設定の作品だけを返す', () => {
    const result = filterWatchHistory(items, {
      decade: "unknown",
      states: [],
    });
    expect(result.map((e) => e.annictWorkId)).toEqual([4]);
  });

  it("視聴状態は複数選択のいずれかに一致する作品を返す", () => {
    const result = filterWatchHistory(items, {
      decade: null,
      states: ["WATCHING", "WANNA_WATCH"],
    });
    expect(result.map((e) => e.annictWorkId)).toEqual([1, 3]);
  });

  it("年代と状態を両方指定した場合は AND で絞り込む", () => {
    const result = filterWatchHistory(items, {
      decade: 2020,
      states: ["WATCHED"],
    });
    expect(result).toEqual([]);
  });
});

describe("sortWatchHistory", () => {
  it("updatedAt は入力順（API の更新日降順）をそのまま返す", () => {
    const items = [entry(1), entry(2), entry(3)];
    expect(sortWatchHistory(items, "updatedAt")).toBe(items);
  });

  it("seasonYear は放送年の新しい順で、年未設定は末尾に寄せる", () => {
    const items = [
      entry(1, { seasonYear: 1998 }),
      entry(2, { seasonYear: null }),
      entry(3, { seasonYear: 2024 }),
      entry(4, { seasonYear: 2013 }),
    ];
    expect(
      sortWatchHistory(items, "seasonYear").map((e) => e.annictWorkId),
    ).toEqual([3, 4, 1, 2]);
  });

  it("watchersCount は視聴者数の多い順で、未取得は末尾に寄せる", () => {
    const items = [
      entry(1, { watchersCount: 10 }),
      entry(2, { watchersCount: null }),
      entry(3, { watchersCount: 5000 }),
      entry(4, { watchersCount: 0 }),
    ];
    expect(
      sortWatchHistory(items, "watchersCount").map((e) => e.annictWorkId),
    ).toEqual([3, 1, 4, 2]);
  });

  it("同値は入力順（更新日降順）を維持する", () => {
    const items = [
      entry(1, { seasonYear: 2020 }),
      entry(2, { seasonYear: 2020 }),
      entry(3, { seasonYear: 2021 }),
    ];
    expect(
      sortWatchHistory(items, "seasonYear").map((e) => e.annictWorkId),
    ).toEqual([3, 1, 2]);
  });
});
