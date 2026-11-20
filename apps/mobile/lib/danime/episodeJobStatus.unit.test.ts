// 話記録ジョブ（issue #477）の状態 → 表示文言の対応付けテスト。
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { episodeJobStatusText } from "./episodeJobStatus";
import type { DanimeEpisodeJob } from "./useDanimeImport";

// i18next 依存を持ち込まず、キーと補間値をそのまま連結して返す偽物。
const fakeT = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}|${JSON.stringify(opts)}` : key) as TFunction;

function job(overrides: Partial<DanimeEpisodeJob>): DanimeEpisodeJob {
  return {
    id: "j1",
    status: "matching",
    total: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    unmatched: 0,
    error: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("episodeJobStatusText", () => {
  it("matching は対応付け中の文言を返す", () => {
    expect(episodeJobStatusText(job({ status: "matching" }), fakeT)).toBe(
      "話の対応付けをしています…",
    );
  });

  it("writing は残り件数（total - done - failed）と失敗数を出す", () => {
    const text = episodeJobStatusText(
      job({ status: "writing", total: 10, done: 6, failed: 1, skipped: 2 }),
      fakeT,
    );
    expect(text).toContain("remaining");
    expect(text).toContain('"remaining":3');
    expect(text).toContain('"failed":1');
  });

  it("completed は記録・失敗・スキップ件数を出す", () => {
    const text = episodeJobStatusText(
      job({ status: "completed", done: 8, failed: 1, skipped: 3 }),
      fakeT,
    );
    expect(text).toContain('"done":8');
    expect(text).toContain('"failed":1');
    expect(text).toContain('"skipped":3');
  });

  it("failed は失敗の文言を返す", () => {
    expect(episodeJobStatusText(job({ status: "failed" }), fakeT)).toBe(
      "話の記録に失敗しました",
    );
  });
});
