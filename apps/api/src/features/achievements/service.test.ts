import { describe, expect, it } from "vitest";
import {
  computeWeeklyStreak,
  evaluateRecordStreak,
  evaluateSeasonCompletion,
  evaluateWatchCount,
  jstWeekIndex,
} from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// JST の週 w の月曜 12:00 に相当する timestamp を返す（テスト入力用）。
function weekTimestamp(weekIndex: number): number {
  return (weekIndex * 7 - 3) * DAY_MS - JST_OFFSET_MS + 12 * 3600 * 1000;
}

// JST の日曜 23:00（週末）に相当する timestamp。
function weekEndTimestamp(weekIndex: number): number {
  return (weekIndex * 7 + 3) * DAY_MS - JST_OFFSET_MS + 23 * 3600 * 1000;
}

describe("jstWeekIndex", () => {
  it("同じ週（月曜〜日曜）は同じインデックスを返す", () => {
    const monday = weekTimestamp(100);
    const sunday = weekEndTimestamp(100);
    expect(jstWeekIndex(monday)).toBe(100);
    expect(jstWeekIndex(sunday)).toBe(100);
  });

  it("JST の月曜 0 時を越えると次の週になる", () => {
    const sundayJst = weekEndTimestamp(100);
    const mondayJst = sundayJst + 2 * 3600 * 1000; // 日曜23時 + 2時間 = 月曜1時 JST
    expect(jstWeekIndex(mondayJst)).toBe(101);
  });

  it("UTC で日曜のままでも JST で月曜なら次の週として扱う", () => {
    // 2026-11-01 15:00 UTC = 2026-11-02 00:00 JST（月曜）。
    // 1 時間前は 2026-11-01 23:00 JST（日曜）= 前の週。
    const utc = Date.UTC(2026, 10, 1, 15, 0, 0);
    const prevHourUtc = utc - 3600 * 1000;
    expect(jstWeekIndex(utc) - jstWeekIndex(prevHourUtc)).toBe(1);
  });
});

describe("computeWeeklyStreak", () => {
  const now = weekTimestamp(200);

  it("記録が無いときは 0/0", () => {
    expect(computeWeeklyStreak([], now)).toEqual({
      currentWeeks: 0,
      bestWeeks: 0,
    });
  });

  it("同じ週の複数記録は 1 週として数える", () => {
    const ats = [weekTimestamp(200), weekEndTimestamp(200), weekTimestamp(200)];
    expect(computeWeeklyStreak(ats, now)).toEqual({
      currentWeeks: 1,
      bestWeeks: 1,
    });
  });

  it("連続した週の記録を数える", () => {
    const ats = [weekTimestamp(198), weekTimestamp(199), weekTimestamp(200)];
    expect(computeWeeklyStreak(ats, now)).toEqual({
      currentWeeks: 3,
      bestWeeks: 3,
    });
  });

  it("今週まだ記録がなくても先週までが連続していれば継続中とみなす", () => {
    const ats = [weekTimestamp(198), weekTimestamp(199)];
    expect(computeWeeklyStreak(ats, now).currentWeeks).toBe(2);
  });

  it("2 週以上前に切れたストリークは current=0、best は残る", () => {
    const ats = [weekTimestamp(190), weekTimestamp(191), weekTimestamp(192)];
    expect(computeWeeklyStreak(ats, now)).toEqual({
      currentWeeks: 0,
      bestWeeks: 3,
    });
  });

  it("途中に空白週があると連続が切れ、最長区間が best になる", () => {
    const ats = [
      weekTimestamp(190),
      weekTimestamp(191),
      weekTimestamp(192),
      // 193 は無記録（切れ目）
      weekTimestamp(194),
      weekTimestamp(195),
      weekTimestamp(200),
    ];
    expect(computeWeeklyStreak(ats, now)).toEqual({
      currentWeeks: 1,
      bestWeeks: 3,
    });
  });
});

describe("evaluateWatchCount", () => {
  it("閾値未満は未獲得、到達した段は獲得になる", () => {
    const items = evaluateWatchCount(50);
    const byId = new Map(items.map((a) => [a.id, a]));
    expect(byId.get("watch_count_10")?.earned).toBe(true);
    expect(byId.get("watch_count_50")?.earned).toBe(true);
    expect(byId.get("watch_count_100")?.earned).toBe(false);
    expect(byId.get("watch_count_100")?.progress).toEqual({
      current: 50,
      target: 100,
    });
  });

  it("0 件では全段未獲得", () => {
    expect(evaluateWatchCount(0).every((a) => !a.earned)).toBe(true);
  });
});

describe("evaluateRecordStreak", () => {
  it("獲得判定は最長記録（best）、進捗は現在の連続週数（current）を使う", () => {
    const items = evaluateRecordStreak({ currentWeeks: 2, bestWeeks: 14 });
    const byId = new Map(items.map((a) => [a.id, a]));
    // 過去に 14 週達していれば 4/12 週バッジは獲得済みのまま
    expect(byId.get("record_streak_4")?.earned).toBe(true);
    expect(byId.get("record_streak_12")?.earned).toBe(true);
    expect(byId.get("record_streak_26")?.earned).toBe(false);
    // 未獲得の 26 週に向けた進捗は「現在の」連続週数
    expect(byId.get("record_streak_26")?.progress).toEqual({
      current: 2,
      target: 26,
    });
  });
});

describe("evaluateSeasonCompletion", () => {
  const candidates = [
    {
      annictWorkId: 100,
      title: "作品A",
      recordedEpisodeIds: new Set([1, 2, 3]),
    },
    {
      annictWorkId: 200,
      title: "作品B",
      recordedEpisodeIds: new Set([10, 11]),
    },
  ];
  const masters = new Map(
    [
      { annictWorkId: 100, episodeIds: [1, 2, 3] },
      { annictWorkId: 200, episodeIds: [10, 11, 12, 13] },
    ].map((m) => [m.annictWorkId, m]),
  );

  it("全話記録した作品があれば獲得（対象作品を返す）", () => {
    const result = evaluateSeasonCompletion(candidates, masters, true);
    expect(result.earned).toBe(true);
    expect(result.work).toEqual({ annictWorkId: 100, title: "作品A" });
    expect(result.progress).toEqual({ current: 3, target: 3 });
  });

  it("どの作品も未完なら、最も完走に近い作品の n/N を進捗にする", () => {
    const partial = [
      {
        annictWorkId: 100,
        title: "作品A",
        recordedEpisodeIds: new Set([1, 2]),
      },
      {
        annictWorkId: 200,
        title: "作品B",
        recordedEpisodeIds: new Set([10, 11, 12]),
      },
    ];
    const result = evaluateSeasonCompletion(partial, masters, true);
    expect(result.earned).toBe(false);
    // 作品Aは 2/3、作品Bは 3/4 → 比率の高い作品B
    expect(result.progress).toEqual({ current: 3, target: 4 });
    expect(result.work).toEqual({ annictWorkId: 200, title: "作品B" });
  });

  it("マスタに無い話の記録は進捗に数えない", () => {
    const orphans = [
      {
        annictWorkId: 200,
        title: "作品B",
        // 話 999 はマスタに存在しない（Annict 側で削除等）
        recordedEpisodeIds: new Set([10, 11, 12, 999]),
      },
    ];
    const result = evaluateSeasonCompletion(orphans, masters, true);
    expect(result.earned).toBe(false);
    expect(result.progress).toEqual({ current: 3, target: 4 });
  });

  it("マスタが 0 話の作品は判定対象にしない", () => {
    const noEpisodes = [
      {
        annictWorkId: 300,
        title: "話数なし作品",
        recordedEpisodeIds: new Set([1]),
      },
    ];
    const emptyMasters = new Map([
      [300, { annictWorkId: 300, episodeIds: [] as number[] }],
    ]);
    const result = evaluateSeasonCompletion(noEpisodes, emptyMasters, true);
    expect(result.earned).toBe(false);
    expect(result.progress.target).toBeNull();
  });

  it("候補が無ければ進捗 0・target なしの未獲得", () => {
    const result = evaluateSeasonCompletion([], masters, true);
    expect(result).toMatchObject({
      earned: false,
      progress: { current: 0, target: null },
    });
  });

  it("available=false のときはデータに関係なく未獲得・判定不可", () => {
    const result = evaluateSeasonCompletion(candidates, masters, false);
    expect(result.earned).toBe(false);
    expect(result.available).toBe(false);
    expect(result.progress.target).toBeNull();
  });
});
