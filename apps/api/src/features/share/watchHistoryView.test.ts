import { describe, it, expect } from "vitest";
import { applyWatchHistoryView, parseWatchHistoryView } from "./service";
import type { SharedWatchHistoryEntry } from "./repository";

function entry(
  overrides: Partial<SharedWatchHistoryEntry> &
    Pick<SharedWatchHistoryEntry, "entryId" | "title">,
): SharedWatchHistoryEntry {
  return {
    annictWorkId: overrides.entryId,
    seasonName: null,
    seasonYear: null,
    state: "WATCHED",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    imageUrl: null,
    resolvedImageUrl: null,
    ...overrides,
  };
}

// repository の既定順（更新日時の降順）に並んだ入力
const items = [
  entry({
    entryId: 1,
    title: "古く追加・最近更新",
    seasonName: "2024-spring",
    seasonYear: 2024,
    state: "WATCHING",
  }),
  entry({
    entryId: 3,
    title: "最後に追加",
    seasonName: "2026-winter",
    seasonYear: 2026,
  }),
  entry({ entryId: 2, title: "年不明", state: "ON_HOLD" }),
  entry({
    entryId: 4,
    title: "同年の秋",
    seasonName: "2026-autumn",
    seasonYear: null,
  }),
];
const history = { ownerUsername: "u", items };
const titles = (view: Parameters<typeof applyWatchHistoryView>[1]) =>
  applyWatchHistoryView(history, view).items.map((i) => i.title);

describe("parseWatchHistoryView", () => {
  it("未指定なら更新順・すべて", () => {
    expect(parseWatchHistoryView({})).toEqual({ sort: "updated", state: null });
  });

  it("既知の値を受け取る", () => {
    expect(
      parseWatchHistoryView({ sort: "year_asc", state: "ON_HOLD" }),
    ).toEqual({
      sort: "year_asc",
      state: "ON_HOLD",
    });
  });

  it("不正な値は既定に倒す", () => {
    expect(
      parseWatchHistoryView({ sort: "toString", state: "watched" }),
    ).toEqual({
      sort: "updated",
      state: null,
    });
  });
});

describe("applyWatchHistoryView", () => {
  it("更新順は入力の順を保つ", () => {
    expect(titles({ sort: "updated", state: null })).toEqual([
      "古く追加・最近更新",
      "最後に追加",
      "年不明",
      "同年の秋",
    ]);
  });

  it("追加順は新しい順・古い順の両方で並べられる", () => {
    expect(titles({ sort: "added_desc", state: null })).toEqual([
      "同年の秋",
      "最後に追加",
      "年不明",
      "古く追加・最近更新",
    ]);
    expect(titles({ sort: "added_asc", state: null })).toEqual([
      "古く追加・最近更新",
      "年不明",
      "最後に追加",
      "同年の秋",
    ]);
  });

  it("年度順は年とシーズンで並べ、放送時期不明は昇順・降順とも末尾に置く", () => {
    expect(titles({ sort: "year_desc", state: null })).toEqual([
      "同年の秋",
      "最後に追加",
      "古く追加・最近更新",
      "年不明",
    ]);
    expect(titles({ sort: "year_asc", state: null })).toEqual([
      "古く追加・最近更新",
      "最後に追加",
      "同年の秋",
      "年不明",
    ]);
  });

  it("ステータスで絞り込める", () => {
    expect(titles({ sort: "updated", state: "WATCHED" })).toEqual([
      "最後に追加",
      "同年の秋",
    ]);
  });
});
