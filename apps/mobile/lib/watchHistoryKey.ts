// 視聴履歴クエリのキー。useWatchHistory と、連携解除時にこのキャッシュを破棄する
// useAnnictConnect（native/web）が共有する。barrel（@/lib/annict）経由の循環 import を
// 避けるため、キーだけを持つ独立モジュールに切り出している。
export const WATCH_HISTORY_QUERY_KEY = ["watch-histories"] as const;
