import { WATCH_STATUS_LABELS } from "@/lib/useWatchHistory";

describe("WATCH_STATUS_LABELS", () => {
  it("全ステータスに日本語ラベルが定義されている", () => {
    expect(WATCH_STATUS_LABELS.watching).toBe("視聴中");
    expect(WATCH_STATUS_LABELS.completed).toBe("完了");
    expect(WATCH_STATUS_LABELS.on_hold).toBe("一時停止");
    expect(WATCH_STATUS_LABELS.dropped).toBe("断念");
    expect(WATCH_STATUS_LABELS.plan_to_watch).toBe("視聴予定");
  });
});
