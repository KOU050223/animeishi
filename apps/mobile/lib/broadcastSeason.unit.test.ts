import { describe, expect, it } from "vitest";
import { compareBroadcastSeason } from "./broadcastSeason";

function entry(
  id: number,
  seasonYear: number | null,
  seasonName?: string | null,
) {
  return { id, seasonYear, seasonName };
}

function sortedIds(items: ReturnType<typeof entry>[], order: "asc" | "desc") {
  return [...items]
    .sort((a, b) => compareBroadcastSeason(a, b, order))
    .map((e) => e.id);
}

describe("compareBroadcastSeason", () => {
  it("降順は年の新しい順で、同年は秋→夏→春→冬の順になる", () => {
    const items = [
      entry(1, 2026, "2026-winter"),
      entry(2, 2025, "2025-autumn"),
      entry(3, 2026, "2026-summer"),
      entry(4, 2026, "2026-autumn"),
      entry(5, 2026, "2026-spring"),
    ];
    expect(sortedIds(items, "desc")).toEqual([4, 3, 5, 1, 2]);
  });

  it("昇順は年の古い順で、同年は冬→春→夏→秋の順になる", () => {
    const items = [
      entry(1, 2026, "2026-autumn"),
      entry(2, 2025, "2025-autumn"),
      entry(3, 2026, "2026-spring"),
      entry(4, 2025, "2025-winter"),
    ];
    expect(sortedIds(items, "asc")).toEqual([4, 2, 3, 1]);
  });

  it("シーズン未設定は同じ年の末尾に寄る（降順）", () => {
    const items = [
      entry(1, 2026, null),
      entry(2, 2026, "2026-winter"),
      entry(3, 2025, "2025-autumn"),
    ];
    // 未設定（id:1）は 2026 年組の末尾だが、年が古い id:3 よりは前
    expect(sortedIds(items, "desc")).toEqual([2, 1, 3]);
  });

  it("シーズン未設定は昇順でも年の末尾に寄り、先頭に来ない", () => {
    const items = [
      entry(1, 2026, null),
      entry(2, 2026, "2026-autumn"),
      entry(3, 2026, "2026-winter"),
    ];
    expect(sortedIds(items, "asc")).toEqual([3, 2, 1]);
  });

  it("seasonName の無いエントリ（undefined）も未設定扱いで年の末尾に寄る", () => {
    const items = [entry(1, 2026), entry(2, 2026, "2026-winter")];
    expect(sortedIds(items, "desc")).toEqual([2, 1]);
    expect(sortedIds(items, "asc")).toEqual([2, 1]);
  });

  it("同年同季は等価（0）で入力順を維持する", () => {
    expect(
      compareBroadcastSeason(
        entry(1, 2026, "2026-spring"),
        entry(2, 2026, "2026-spring"),
        "desc",
      ),
    ).toBe(0);
    const items = [
      entry(1, 2026, "2026-spring"),
      entry(2, 2026, "2026-spring"),
      entry(3, 2026, "2026-autumn"),
    ];
    expect(sortedIds(items, "desc")).toEqual([3, 1, 2]);
  });

  it("年が違えばシーズンに関わらず年が優先される", () => {
    const items = [
      entry(1, 2025, "2025-autumn"),
      entry(2, 2026, "2026-winter"),
    ];
    expect(sortedIds(items, "desc")).toEqual([2, 1]);
    expect(sortedIds(items, "asc")).toEqual([1, 2]);
  });

  it("放送年未設定（seasonYear null）は降順で末尾・昇順で先頭に寄る", () => {
    const items = [
      entry(1, null, null),
      entry(2, 2026, "2026-autumn"),
      entry(3, 2025, "2025-winter"),
    ];
    expect(sortedIds(items, "desc")).toEqual([2, 3, 1]);
    expect(sortedIds(items, "asc")).toEqual([1, 3, 2]);
  });

  it("Annict が返さない形式の seasonName は未設定と同じく年の末尾に寄る", () => {
    const items = [
      entry(1, 2026, "2026-unknown"),
      entry(2, 2026, "2026-winter"),
      entry(3, 2026, "all"),
    ];
    // 未設定同士（id:1, 3）は入力順を維持する
    expect(sortedIds(items, "desc")).toEqual([2, 1, 3]);
  });
});
