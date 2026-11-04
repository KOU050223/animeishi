import { describe, it, expect } from "vitest";
import { eventPhase, formatEventPeriod } from "./eventPeriod";

// イベント（issue #411）の会期表示。「2026年12月20日(日)〜12月21日(月)」
// のような表記と、開催前/開催中/終了の状態を検証する。

describe("formatEventPeriod", () => {
  it("同日の会期は 1 日分だけ表示する", () => {
    expect(
      formatEventPeriod(
        "2026-12-20T10:00:00+09:00",
        "2026-12-20T16:00:00+09:00",
      ),
    ).toBe("2026年12月20日(日)");
  });

  it("同年の複数日は終了側の年を省略する", () => {
    expect(
      formatEventPeriod(
        "2026-12-20T10:00:00+09:00",
        "2026-12-21T16:00:00+09:00",
      ),
    ).toBe("2026年12月20日(日)〜12月21日(月)");
  });

  it("年をまたぐ会期は終了側も年を表示する", () => {
    expect(
      formatEventPeriod(
        "2026-12-30T10:00:00+09:00",
        "2027-01-02T16:00:00+09:00",
      ),
    ).toBe("2026年12月30日(水)〜2027年1月2日(土)");
  });

  it("解釈できない日時は空文字", () => {
    expect(formatEventPeriod("not a date", "2026-12-20T00:00:00Z")).toBe("");
  });
});

describe("eventPhase", () => {
  const startsAt = "2026-12-20T10:00:00+09:00";
  const endsAt = "2026-12-21T16:00:00+09:00";

  it("開始前は before、会期中は ongoing、終了後は ended", () => {
    expect(
      eventPhase(startsAt, endsAt, new Date("2026-12-20T09:59:59+09:00")),
    ).toBe("before");
    expect(
      eventPhase(startsAt, endsAt, new Date("2026-12-20T10:00:00+09:00")),
    ).toBe("ongoing");
    expect(
      eventPhase(startsAt, endsAt, new Date("2026-12-21T16:00:00+09:00")),
    ).toBe("ongoing");
    expect(
      eventPhase(startsAt, endsAt, new Date("2026-12-21T16:00:01+09:00")),
    ).toBe("ended");
  });
});
