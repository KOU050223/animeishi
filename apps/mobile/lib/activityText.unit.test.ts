import { describe, it, expect, vi, afterEach } from "vitest";
import {
  activityText,
  activityGroupText,
  formatRelativeTime,
} from "./activityText";
import type { ActivityFeedItem } from "./useActivityFeed";
import type { TFunction } from "i18next";

const translations: Record<string, string> = {
  "{{username}} は {{work}} の視聴ステータスを {{status}} に変更しました":
    "{{username}} changed the watch status of ‘{{work}}’ to {{status}}",
  "{{username}} は {{work}} を推しに追加しました":
    "{{username}} added ‘{{work}}’ to favorites",
  "{{username}} は {{list}} を作成しました": "{{username}} created {{list}}",
  "{{username}} は {{list}} を共有しました": "{{username}} shared {{list}}",
  "{{work}} の Tier 表": "Tier list for ‘{{work}}’",
  "{{list}}「{{title}}」": "{{list}}: {{title}}",
  "{{count}} 分前": "{{count}} minutes ago",
  "{{count}} 時間前": "{{count}} hours ago",
  "{{count}} 日前": "{{count}} days ago",
  "{{month}}/{{day}}": "{{month}}/{{day}}",
  たった今: "Just now",
  Tier表: "Tier list",
  作品: "anime",
  視聴: "watching",
  視聴中: "watching",
  断念: "dropped",
  "{{username}} は {{count}} 件の記録を {{status}} に更新しました":
    "{{username}} updated {{count}} records to {{status}}",
  "{{username}} は {{count}} 件の記録を更新しました":
    "{{username}} updated {{count}} records",
};
const t = ((key: string, values?: Record<string, unknown>) =>
  (translations[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => {
    const value = values?.[name];
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  })) as unknown as TFunction;

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
  it("watch_status は英語の視聴ステータス文にする", () => {
    expect(
      activityText(
        item({
          type: "watch_status",
          work: WORK,
          meta: { state: "WATCHING" },
        }),
        t,
      ),
    ).toBe("たろう changed the watch status of ‘テストアニメ’ to watching");
  });

  it("favorite_added は推し追加の文にする", () => {
    expect(activityText(item({ type: "favorite_added", work: WORK }), t)).toBe(
      "たろう added ‘テストアニメ’ to favorites",
    );
  });

  it("tier_list_created（シーズン）は meta.title 付きの Tier 表作成にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_created",
          meta: { kind: "season", season: "2026-spring", title: "自分の表" },
        }),
        t,
      ),
    ).toBe("たろう created Tier list: 自分の表");
  });

  it("tier_list_created（キャラクター）は作品名付きの Tier 表にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_created",
          work: WORK,
          meta: { kind: "character", title: "自分の表" },
        }),
        t,
      ),
    ).toBe("たろう created Tier list for ‘テストアニメ’: 自分の表");
  });

  it("tier_list_shared は共有の文にする", () => {
    expect(
      activityText(
        item({
          type: "tier_list_shared",
          meta: { kind: "season", season: "2026-spring", title: "自分の表" },
        }),
        t,
      ),
    ).toBe("たろう shared Tier list: 自分の表");
  });

  it("未知のステータスでも汎用の文にする", () => {
    expect(
      activityText(
        item({ type: "watch_status", work: WORK, meta: { state: "UNKNOWN" } }),
        t,
      ),
    ).toBe("たろう changed the watch status of ‘テストアニメ’ to watching");
  });
});

describe("activityGroupText", () => {
  it("同じステータスへの一括変更は件数つきの更新文にする", () => {
    const group = [
      item({ meta: { state: "STOP_WATCHING" } }),
      item({ id: 2, meta: { state: "STOP_WATCHING" } }),
      item({ id: 3, meta: { state: "STOP_WATCHING" } }),
    ];
    expect(activityGroupText(group, t)).toBe(
      "たろう updated 3 records to dropped",
    );
  });

  it("未知のステータスを含むまとめはステータス名なしの文にする", () => {
    const group = [
      item({ meta: { state: "UNKNOWN" } }),
      item({ id: 2, meta: { state: "UNKNOWN" } }),
    ];
    expect(activityGroupText(group, t)).toBe("たろう updated 2 records");
  });
});

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 分未満は just now、分・時間・日を英語で返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(formatRelativeTime("2026-01-10T11:59:30Z", t)).toBe("Just now");
    expect(formatRelativeTime("2026-01-10T11:30:00Z", t)).toBe(
      "30 minutes ago",
    );
    expect(formatRelativeTime("2026-01-10T09:00:00Z", t)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-01-08T12:00:00Z", t)).toBe("2 days ago");
  });

  it("30 日以上前は月日を返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    expect(formatRelativeTime("2026-01-15T12:00:00Z", t)).toBe("1/15");
  });
});
