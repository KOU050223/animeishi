import type { ActivityFeedItem } from "./useActivityFeed";

// 一括操作（dアニメストアのインポート等）で短時間に連続して記録された
// 視聴ステータス変更を 1 行にまとめる条件（issue #533）。
// 一括操作の記録は秒〜分単位で連続するため、直前の活動からこの間隔を
// 超えたら別の連続として切る。
export const ACTIVITY_GROUP_GAP_MS = 5 * 60 * 1000;
// 2 件のまとめは個別表示（作品名が見える）の方が情報量が高いため、
// この件数以上の連続だけを畳む。
export const ACTIVITY_GROUP_MIN_ITEMS = 3;

export type ActivityFeedEntry =
  | { kind: "item"; key: string; item: ActivityFeedItem }
  // まとめた活動。items は新しい順で、先頭が代表（アバター・時刻の表示元）。
  | { kind: "group"; key: string; items: ActivityFeedItem[] };

// まとめるのは視聴ステータス変更だけ（issue #533 のスコープ）。
// 「同じユーザーが同じ状態に変更した記録」が同じキーになる。
// 他の活動種別は一括記録の経路が無いため個別表示のままにする。
function groupKeyOf(item: ActivityFeedItem): string | null {
  if (item.type !== "watch_status") return null;
  const state = item.meta?.state;
  return `${item.actor.userId}:${typeof state === "string" ? state : ""}`;
}

// 新しい順の活動一覧を、連続する同種のステータス変更（同じユーザー・同じ
// 遷移先・記録時刻が ACTIVITY_GROUP_GAP_MS 以内）で畳んだ表示要素に変換する。
// 異なる活動を挟む・間隔が空く・ACTIVITY_GROUP_MIN_ITEMS 未満の連続は
// 個別表示のまま残る。ページ境界をまたぐ連続はページ読み込み後に再計算される。
export function groupActivityItems(
  items: ActivityFeedItem[],
): ActivityFeedEntry[] {
  const entries: ActivityFeedEntry[] = [];
  let run: ActivityFeedItem[] = [];

  const flush = () => {
    if (run.length >= ACTIVITY_GROUP_MIN_ITEMS) {
      entries.push({ kind: "group", key: `group-${run[0].id}`, items: run });
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
