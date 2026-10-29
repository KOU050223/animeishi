import type { ActivityFeedItem } from "@/lib/useActivityFeed";
import { WATCH_STATUS_LABELS } from "@/lib/watchStatusLabels";

// フィード 1 件を「『タイトル』を…しました」という行にする。
// work を持たない活動（シーズンの Tier 表など）は meta 側の題材を使う。
export function activityText(item: ActivityFeedItem): string {
  switch (item.type) {
    case "watch_status": {
      const state = item.meta?.state;
      const label =
        typeof state === "string" && state in WATCH_STATUS_LABELS
          ? WATCH_STATUS_LABELS[state as keyof typeof WATCH_STATUS_LABELS]
          : null;
      return `『${item.work?.title ?? "作品"}』を${label ?? "視聴"}にしました`;
    }
    case "favorite_added":
      return `『${item.work?.title ?? "作品"}』を推しに追加しました`;
    case "tier_list_created":
      return `${tierListLabel(item)}を作成しました`;
    case "tier_list_shared":
      return `${tierListLabel(item)}を共有しました`;
  }
}

// Tier 表の題材。キャラクター版は対象作品名、シーズン版は表のタイトルがある。
function tierListLabel(item: ActivityFeedItem): string {
  const title = item.meta?.title;
  const base = item.work ? `『${item.work.title}』のTier表` : "Tier表";
  return typeof title === "string" ? `${base}「${title}」` : base;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}日前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
