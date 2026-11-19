import type { ActivityFeedItem } from "@/lib/useActivityFeed";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";
import type { TFunction } from "i18next";

// フィード 1 件を「『タイトル』を…しました」という行にする。
// work を持たない活動（シーズンの Tier 表など）は meta 側の題材を使う。
export function activityText(item: ActivityFeedItem, t: TFunction): string {
  switch (item.type) {
    case "watch_status": {
      const state = item.meta?.state;
      const label =
        typeof state === "string" && state in WATCH_STATUS_LABELS
          ? WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS]
          : null;
      return t(
        "{{username}} は {{work}} の視聴ステータスを {{status}} に変更しました",
        {
          username: item.actor.username,
          work: item.work?.title ?? t("作品"),
          status: label ? t(label) : t("視聴"),
        },
      );
    }
    case "favorite_added":
      return t("{{username}} は {{work}} を推しに追加しました", {
        username: item.actor.username,
        work: item.work?.title ?? t("作品"),
      });
    case "tier_list_created":
      return t("{{username}} は {{list}} を作成しました", {
        username: item.actor.username,
        list: tierListLabel(item, t),
      });
    case "tier_list_shared":
      return t("{{username}} は {{list}} を共有しました", {
        username: item.actor.username,
        list: tierListLabel(item, t),
      });
  }
}

export function activityGroupText(
  items: ActivityFeedItem[],
  t: TFunction,
): string {
  const first = items[0];
  const state = first?.meta?.state;
  const label =
    typeof state === "string" && state in WATCH_STATUS_LABELS
      ? WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS]
      : null;
  if (label) {
    return t("{{username}} は {{count}} 件の記録を {{status}} に更新しました", {
      username: first?.actor.username,
      count: items.length,
      status: t(label),
    });
  }
  return t("{{username}} は {{count}} 件の記録を更新しました", {
    username: first?.actor.username,
    count: items.length,
  });
}

// Tier 表の題材。キャラクター版は対象作品名、シーズン版は表のタイトルがある。
function tierListLabel(item: ActivityFeedItem, t: TFunction): string {
  const title = item.meta?.title;
  const base = item.work
    ? t("{{work}} の Tier 表", { work: item.work.title })
    : t("Tier表");
  return typeof title === "string"
    ? t("{{list}}「{{title}}」", { list: base, title })
    : base;
}

export function formatRelativeTime(iso: string, t: TFunction): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("たった今");
  if (minutes < 60) return t("{{count}} 分前", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{{count}} 時間前", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("{{count}} 日前", { count: days });
  const d = new Date(iso);
  return t("{{month}}/{{day}}", {
    month: d.getMonth() + 1,
    day: d.getDate(),
  });
}
