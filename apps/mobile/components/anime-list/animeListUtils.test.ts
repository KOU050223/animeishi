import {
  SEASON_KEYS,
  SEASON_PICKER_MIN_YEAR,
  maxSelectableSeason,
  seasonPickerYears,
  selectableSeasonKeys,
  shiftSeason,
} from "./animeListUtils";

describe("shiftSeason", () => {
  it("+1 で秋→冬は年をまたぐ", () => {
    expect(shiftSeason(2026, "autumn", 1)).toEqual({
      year: 2027,
      key: "winter",
    });
  });

  it("+2 で 2 シーズン先へ進む", () => {
    expect(shiftSeason(2026, "autumn", 2)).toEqual({
      year: 2027,
      key: "spring",
    });
    expect(shiftSeason(2026, "winter", 2)).toEqual({
      year: 2026,
      key: "summer",
    });
  });
});

describe("maxSelectableSeason", () => {
  it("今期の 2 シーズン先を返す", () => {
    // 2026 秋（10 月）→ 上限は 2027 春
    expect(maxSelectableSeason(new Date(2026, 9, 15))).toEqual({
      year: 2027,
      key: "spring",
    });
    // 2026 冬（1 月）→ 上限は同年の 2026 夏
    expect(maxSelectableSeason(new Date(2026, 0, 15))).toEqual({
      year: 2026,
      key: "summer",
    });
  });
});

describe("seasonPickerYears", () => {
  it("選択可能な最新年から Annict アーカイブ最古年まで降順で返す", () => {
    const years = seasonPickerYears(new Date(2026, 9, 15));
    expect(years[0]).toBe(2027);
    expect(years[years.length - 1]).toBe(SEASON_PICKER_MIN_YEAR);
    expect(years).toHaveLength(2027 - SEASON_PICKER_MIN_YEAR + 1);
  });

  it("上限が年内に収まる場合は今年が先頭になる", () => {
    const years = seasonPickerYears(new Date(2026, 0, 15));
    expect(years[0]).toBe(2026);
  });
});

describe("selectableSeasonKeys", () => {
  // 2026 秋（10 月）。選択上限は 2027 春。
  const now = new Date(2026, 9, 15);

  it("上限年は今期+2 シーズンまで選べる", () => {
    expect(selectableSeasonKeys(2027, now)).toEqual(["winter", "spring"]);
  });

  it("上限年より前は全シーズン選べる", () => {
    expect(selectableSeasonKeys(2026, now)).toEqual([...SEASON_KEYS]);
    expect(selectableSeasonKeys(1890, now)).toEqual([...SEASON_KEYS]);
  });

  it("上限年より未来は選べない", () => {
    expect(selectableSeasonKeys(2028, now)).toEqual([]);
  });
});
