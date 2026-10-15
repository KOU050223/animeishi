import {
  SEASON_KEYS,
  SEASON_PICKER_MIN_YEAR,
  adjacentSeasonParams,
  currentSeason,
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

describe("currentSeason", () => {
  it("端末タイムゾーンではなく JST 基準で今期を返す", () => {
    // UTC 3/31 16:00 = JST 4/1 01:00。ローカル基準なら冬のままだが、
    // API（currentAnnictSeason）と同じく JST なら春。
    expect(currentSeason(new Date(Date.UTC(2026, 2, 31, 16)))).toEqual({
      year: 2026,
      key: "spring",
    });
  });

  it("JST で年をまたぐ場合は新しい年を返す", () => {
    // UTC 12/31 16:00 = JST 1/1 01:00
    expect(currentSeason(new Date(Date.UTC(2026, 11, 31, 16)))).toEqual({
      year: 2027,
      key: "winter",
    });
  });
});

describe("maxSelectableSeason", () => {
  it("期境界を API と同じ JST 基準で判定する", () => {
    // UTC 3/31 16:00 = JST 4/1（春）。選択上限は 春+2 = 2026 秋。
    // 端末ローカル基準（まだ冬）だと夏で止まってしまう。
    expect(maxSelectableSeason(new Date(Date.UTC(2026, 2, 31, 16)))).toEqual({
      year: 2026,
      key: "autumn",
    });
  });

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

describe("adjacentSeasonParams", () => {
  // 2026 秋（10 月）。選択上限は 2027 春。
  const now = new Date(2026, 9, 15);

  it("前後のシーズンを season 文字列で返す", () => {
    expect(adjacentSeasonParams(2026, "summer", now)).toEqual([
      "2026-spring",
      "2026-autumn",
    ]);
  });

  it("年をまたぐ前後シーズンも正しく組み立てる", () => {
    expect(adjacentSeasonParams(2026, "winter", now)).toEqual([
      "2025-autumn",
      "2026-spring",
    ]);
    expect(adjacentSeasonParams(2026, "autumn", now)).toEqual([
      "2026-summer",
      "2027-winter",
    ]);
  });

  it("選択上限（今期+2）にいるときは次シーズンを含めない", () => {
    // 上限は 2027 春。2027 春の次 = 2027 夏は選べないため前期のみ。
    expect(adjacentSeasonParams(2027, "spring", now)).toEqual(["2027-winter"]);
  });

  it("アーカイブ下限年の冬では前シーズンを含めない", () => {
    // 1890 冬の前 = 1889 秋は SEASON_PICKER_MIN_YEAR を下回るため次のみ。
    expect(adjacentSeasonParams(1890, "winter", now)).toEqual(["1890-spring"]);
  });
});
