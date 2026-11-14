// 視聴履歴クエリのキー。useWatchHistory と、連携解除時にこのキャッシュを破棄する
// useAnnictConnect（native/web）が共有する。barrel（@/lib/annict）経由の循環 import を
// 避けるため、キーだけを持つ独立モジュールに切り出している。
export const WATCH_HISTORY_QUERY_KEY = ["watch-histories"] as const;

// 視聴履歴の書き込みミューテーション（upsert・解除）のスコープ。
// 同じスコープの mutation は MutationCache が直列実行される。
// useWorkDetail も「書き込み中か」を判定するため、useWatchHistory への
// import で循環しないようここに置く。
export const WATCH_HISTORY_WRITE_SCOPE = "watch-history-write";
