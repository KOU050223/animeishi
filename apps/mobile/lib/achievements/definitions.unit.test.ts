import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  achievementBadgeLabel,
  achievementEarnedKey,
  achievementName,
  diffNewlyEarned,
  earnedAchievementKeys,
} from "./definitions";
import type { Achievement } from "./types";

// 日本語キーをそのまま返し、{{name}} 補間だけ処理する簡易 t。
// （ja はキーがそのまま文言になる設計のため、これで表示結果と一致する）
const t = ((key: string, opts?: Record<string, unknown>) => {
  let s = key;
  for (const [k, v] of Object.entries(opts ?? {})) {
    s = s.replaceAll(`{{${k}}}`, String(v));
  }
  return s;
}) as TFunction;

function achievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: "watch_count_10",
    kind: "watch_count",
    threshold: 10,
    earned: false,
    available: true,
    progress: { current: 0, target: 10 },
    ...overrides,
  };
}

describe("achievementName", () => {
  it("kind ごとの表示名を返す", () => {
    expect(achievementName(t, { kind: "watch_count", threshold: 100 })).toBe(
      "視聴 100 作品",
    );
    expect(achievementName(t, { kind: "record_streak", threshold: 4 })).toBe(
      "4 週連続記録",
    );
    expect(
      achievementName(t, { kind: "season_completion", threshold: null }),
    ).toBe("今期完走");
  });
});

describe("achievementEarnedKey", () => {
  it("今期完走はシーズンを含め、シーズンが変われば別キーになる", () => {
    const a = achievement({
      id: "season_completion",
      kind: "season_completion",
      threshold: null,
    });
    expect(achievementEarnedKey(a, "2026-autumn")).toBe(
      "season_completion@2026-autumn",
    );
    expect(achievementEarnedKey(a, "2027-winter")).not.toBe(
      achievementEarnedKey(a, "2026-autumn"),
    );
  });

  it("段階制の実績は実績 ID をそのまま使う", () => {
    const a = achievement({ id: "watch_count_100" });
    expect(achievementEarnedKey(a, "2026-autumn")).toBe("watch_count_100");
  });
});

describe("diffNewlyEarned", () => {
  const response = {
    season: "2026-autumn",
    achievements: [
      achievement({ id: "watch_count_10", earned: true }),
      achievement({ id: "watch_count_50", threshold: 50, earned: true }),
      achievement({ id: "watch_count_100", threshold: 100, earned: false }),
      achievement({
        id: "season_completion",
        kind: "season_completion",
        threshold: null,
        earned: true,
      }),
    ],
  };

  it("獲得済みキーの一覧を作れる", () => {
    expect(earnedAchievementKeys(response).sort()).toEqual([
      "season_completion@2026-autumn",
      "watch_count_10",
      "watch_count_50",
    ]);
  });

  it("既見に無い獲得済み実績だけを返す", () => {
    const seen = new Set([
      "watch_count_10",
      "watch_count_50",
      "season_completion@2026-autumn",
    ]);
    expect(diffNewlyEarned(response, seen)).toEqual([]);
    expect(diffNewlyEarned(response, new Set(["watch_count_10"]))).toEqual([
      response.achievements[1],
      response.achievements[3],
    ]);
  });

  it("未獲得の実績は新規獲得に含めない", () => {
    expect(diffNewlyEarned(response, new Set())).toEqual([
      response.achievements[0],
      response.achievements[1],
      response.achievements[3],
    ]);
  });
});

describe("achievementBadgeLabel", () => {
  const items = [
    { kind: "watch_count", threshold: 10, earned: true },
    { kind: "watch_count", threshold: 50, earned: true },
    { kind: "watch_count", threshold: 100, earned: false },
  ];

  it("獲得済みの最高段の名前を返す", () => {
    expect(achievementBadgeLabel(t, "watch_count", items)).toBe("視聴 50 作品");
  });

  it("未獲得なら最初の段に（未獲得）を付ける", () => {
    const unearned = items.map((i) => ({ ...i, earned: false }));
    expect(achievementBadgeLabel(t, "watch_count", unearned)).toBe(
      "視聴 10 作品（未獲得）",
    );
  });

  it("実績データが無くても未獲得表示に倒せる", () => {
    expect(achievementBadgeLabel(t, "record_streak", [])).toBe(
      "連続記録（未獲得）",
    );
    expect(achievementBadgeLabel(t, "season_completion", [])).toBe(
      "今期完走（未獲得）",
    );
  });

  it("別 kind の実績は対象にしない", () => {
    const mixed = [
      { kind: "record_streak", threshold: 4, earned: true },
      ...items,
    ];
    expect(achievementBadgeLabel(t, "watch_count", mixed)).toBe("視聴 50 作品");
  });
});
