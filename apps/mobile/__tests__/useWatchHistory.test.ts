import { WATCH_STATUS_LABELS } from "@/lib/useWatchHistory";

describe("WATCH_STATUS_LABELS", () => {
  it("全ステータスに日本語ラベルが定義されている", () => {
    expect(WATCH_STATUS_LABELS.WATCHING).toBe("視聴中");
    expect(WATCH_STATUS_LABELS.WATCHED).toBe("視聴済");
    expect(WATCH_STATUS_LABELS.ON_HOLD).toBe("一時停止");
    expect(WATCH_STATUS_LABELS.STOP_WATCHING).toBe("断念");
    expect(WATCH_STATUS_LABELS.WANNA_WATCH).toBe("視聴予定");
  });
});
