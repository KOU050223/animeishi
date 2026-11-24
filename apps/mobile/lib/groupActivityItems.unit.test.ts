import { describe, it, expect } from "vitest";
import {
  groupActivityItems,
  ACTIVITY_GROUP_GAP_MS,
  ACTIVITY_GROUP_MIN_ITEMS,
} from "./groupActivityItems";
import type { ActivityFeedItem } from "./useActivityFeed";

const T0 = new Date("2026-01-10T12:00:00.000Z").getTime();

let nextId = 0;
function item(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  nextId += 1;
  return {
    id: nextId,
    type: "watch_status",
    // 既定は 1 分刻みで新しい順に積まれるようにする
    createdAt: new Date(T0 - nextId * 60_000).toISOString(),
    actor: { userId: "u1", username: "たろう", profileImageUrl: null },
    work: null,
    meta: { state: "STOP_WATCHING" },
    ...overrides,
  };
}

// まとめ条件を満たす n 件の連続を作る
function bulkRun(count: number, overrides: Partial<ActivityFeedItem> = {}) {
  return Array.from({ length: count }, () => item(overrides));
}

describe("groupActivityItems", () => {
  it("同じユーザー・同じステータスの連続は最小件数以上で 1 つのまとめになる", () => {
    const run = bulkRun(ACTIVITY_GROUP_MIN_ITEMS);
    const entries = groupActivityItems(run);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.kind).toBe("group");
    if (entry?.kind === "group") {
      expect(entry.items).toHaveLength(ACTIVITY_GROUP_MIN_ITEMS);
    }
  });

  it("最小件数未満の連続は個別表示のままにする", () => {
    const run = bulkRun(ACTIVITY_GROUP_MIN_ITEMS - 1);
    const entries = groupActivityItems(run);
    expect(entries).toHaveLength(ACTIVITY_GROUP_MIN_ITEMS - 1);
    expect(entries.every((e) => e.kind === "item")).toBe(true);
  });

  it("別のステータスの活動が挟まると連続が切れる", () => {
    const items = [
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
      item({ meta: { state: "WATCHING" } }),
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
    ];
    const entries = groupActivityItems(items);
    expect(entries.map((e) => e.kind)).toEqual(["group", "item", "group"]);
  });

  it("違うユーザーの活動が挟まると連続が切れる", () => {
    const other = {
      userId: "u2",
      username: "はなこ",
      profileImageUrl: null,
    };
    const items = [
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
      item({ actor: other }),
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
    ];
    const entries = groupActivityItems(items);
    expect(entries.map((e) => e.kind)).toEqual(["group", "item", "group"]);
  });

  it("ステータス変更以外の活動はまとめず連続も切る", () => {
    const items = [
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
      item({ type: "favorite_added", meta: null }),
      item({ type: "favorite_added", meta: null }),
      item({ type: "favorite_added", meta: null }),
      ...bulkRun(ACTIVITY_GROUP_MIN_ITEMS),
    ];
    const entries = groupActivityItems(items);
    expect(entries.map((e) => e.kind)).toEqual([
      "group",
      "item",
      "item",
      "item",
      "group",
    ]);
  });

  it("記録時刻の間隔が閾値を超えると連続が切れる", () => {
    const close = bulkRun(ACTIVITY_GROUP_MIN_ITEMS);
    const far = item({
      createdAt: new Date(
        // bulkRun(3) は必ず 3 件返すため末尾は存在する。
        new Date(close[close.length - 1]!.createdAt).getTime() -
          ACTIVITY_GROUP_GAP_MS -
          1,
      ).toISOString(),
    });
    const later = bulkRun(ACTIVITY_GROUP_MIN_ITEMS - 1, {
      // far よりさらに後（時刻が古い）側の連続
    }).map((run, i) => ({
      ...run,
      createdAt: new Date(
        new Date(far.createdAt).getTime() - (i + 1) * 60_000,
      ).toISOString(),
    }));
    const entries = groupActivityItems([...close, far, ...later]);
    // close の 3 件はまとまり、閾値超過で切れた far + later の 3 件は
    // 連続自体は続くが far 起点で再びまとまる（別グループ）
    expect(entries.map((e) => e.kind)).toEqual(["group", "group"]);
    const entry = entries[1];
    if (entry?.kind === "group") {
      expect(entry.items).toHaveLength(ACTIVITY_GROUP_MIN_ITEMS);
    }
  });

  it("間隔が閾値ちょうどなら同じ連続に含める", () => {
    // bulkRun(1) は必ず 1 件返す。
    const first = bulkRun(1)[0]!;
    const second = item({
      createdAt: new Date(
        new Date(first.createdAt).getTime() - ACTIVITY_GROUP_GAP_MS,
      ).toISOString(),
    });
    const third = item({
      createdAt: new Date(
        new Date(second.createdAt).getTime() - 60_000,
      ).toISOString(),
    });
    const entries = groupActivityItems([first, second, third]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("group");
  });

  it("まとめの代表は先頭（最新）の活動", () => {
    const run = bulkRun(ACTIVITY_GROUP_MIN_ITEMS + 2);
    const entries = groupActivityItems(run);
    const entry = entries[0];
    expect(entry?.kind).toBe("group");
    if (entry?.kind === "group") {
      // bulkRun は必ず要求件数を返すため run[0] は存在する。
      expect(entry.items[0]?.id).toBe(run[0]!.id);
      expect(entry.key).toBe(`group-${run[0]!.id}`);
    }
  });

  it("まとめられない活動は順序を保ったまま個別要素になる", () => {
    const items = [
      item({ type: "favorite_added", meta: null }),
      item({ meta: { state: "WATCHING" } }),
      item({ type: "tier_list_created", meta: null }),
    ];
    const entries = groupActivityItems(items);
    expect(entries.map((e) => e.kind)).toEqual(["item", "item", "item"]);
    expect(entries[0]?.key).toBe(`item-${items[0]!.id}`);
  });

  it("空の一覧は空を返す", () => {
    expect(groupActivityItems([])).toEqual([]);
  });
});
