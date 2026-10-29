import { describe, it, expect, vi, afterEach } from "vitest";
import { activityText, formatRelativeTime } from "./activityText";
import type { ActivityFeedItem } from "./useActivityFeed";

function item(overrides: Partial<ActivityFeedItem>): ActivityFeedItem {
  return {
    id: 1,
    type: "watch_status",
    createdAt: "2026-01-01T00:00:00.000Z",
    actor: { userId: "u1", username: "たろう", profileImageUrl: null },
    work: null,
    meta: null,
    ...overrides,
  };
}

const WORK = {
  annictWorkId: 1,
  title: "テストアニメ",
  titleEn: null,
  hostedImageUrl: null,
};

describe("activityText", () => {
  it("watch_status は視聴ステータスの日本語ラベル付きで返す", () => {
    expect(
      activityText(
        item({
          type: "watch_status",
          work: WORK,
          meta: { state: "WATCHING" },
        }),
      ),
    ).toBe("『テストアニメ』を視聴中にしました");
  });

  it("favorite_added は推し追加の文にする", () => {
    expect(activityText(item({ type: "favorite_added", work: WORK }))).toBe(
      "『テストアニメ』を推しに追加しました",
    );
  });

  it("tier_list_created（シーズン）は meta.title 付きの Tier 表作成にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_created",
          meta: { kind: "season", season: "2026-spring", title: "自分の表" },
        }),
      ),
    ).toBe("Tier表「自分の表」を作成しました");
  });

  it("tier_list_created（キャラクター）は作品名付きの Tier 表にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_created",
          work: WORK,
          meta: { kind: "character", title: "自分の表" },
        }),
      ),
    ).toBe("『テストアニメ』のTier表「自分の表」を作成しました");
  });

  it("tier_list_shared は共有の文にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_shared",
          meta: { kind: "season", season: "2026-spring", title: "自分の表" },
        }),
      ),
    ).toBe("Tier表「自分の表」を共有しました");
  });

  it("未知のステータスでも落ちず汎用の文にする", () => {
    expect(
      activityText(
        item({ type: "watch_status", work: WORK, meta: { state: "UNKNOWN" } }),
      ),
    ).toBe("『テストアニメ』を視聴にしました");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 分未満は「たった今」、分・時間・日を日本語で返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(formatRelativeTime("2026-01-10T11:59:30Z")).toBe("たった今");
    expect(formatRelativeTime("2026-01-10T11:30:00Z")).toBe("30分前");
    expect(formatRelativeTime("2026-01-10T09:00:00Z")).toBe("3時間前");
    expect(formatRelativeTime("2026-01-08T12:00:00Z")).toBe("2日前");
  });

  it("30 日以上前は月日を返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    expect(formatRelativeTime("2026-01-15T12:00:00Z")).toBe("1月15日");
  });
});
