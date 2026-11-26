import type { ActivityFeedItem } from "@/lib/useActivityFeed";

// ステータス変更の活動は個別の PUT ごとに記録されるため、履歴画面などで
// 続けて更新すると秒〜分単位で同種の行が連なって並ぶ。この間隔を超えた
// ら別のまとまりとして切る（issue #533）。
export const ACTIVITY_GROUP_GAP_MS = 5 * 60 * 1000;
// 2 件のまとめは個別表示（作品名が見える）の方が情報量が高いため、
// この件数以上の連続だけを畳む。
export const ACTIVITY_GROUP_MIN_ITEMS = 3;

export type ActivityFeedEntry =
  | { kind: "item"; key: string; item: ActivityFeedItem }
  // items は新しい順（先頭がアバター・時刻の表示元）。
  | { kind: "group"; key: string; items: ActivityFeedItem[] };

// まとめるのは issue #533 の対象の watch_status だけ。
function groupKeyOf(item: ActivityFeedItem): string | null {
  if (item.type !== "watch_status") return null;
  const state = item.meta?.state;
  return `${item.actor.userId}:${typeof state === "string" ? state : ""}`;
}

export function groupActivityItems(
  items: ActivityFeedItem[],
): ActivityFeedEntry[] {
  const entries: ActivityFeedEntry[] = [];
  let run: ActivityFeedItem[] = [];

  const flush = () => {
    const first = run[0];
    if (run.length >= ACTIVITY_GROUP_MIN_ITEMS && first) {
      entries.push({ kind: "group", key: `group-${first.id}`, items: run });
    } else {
      for (const item of run) {
        entries.push({ kind: "item", key: `item-${item.id}`, item });
      }
    }
    run = [];
  };

  for (const item of items) {
    const key = groupKeyOf(item);
    const prev = run[run.length - 1];
    const continues =
      key !== null &&
      prev !== undefined &&
      groupKeyOf(prev) === key &&
      Math.abs(
        new Date(prev.createdAt).getTime() - new Date(item.createdAt).getTime(),
      ) <= ACTIVITY_GROUP_GAP_MS;

    if (!continues) flush();
    if (key === null) {
      entries.push({ kind: "item", key: `item-${item.id}`, item });
    } else {
      run.push(item);
    }
  }
  flush();

  return entries;
}
