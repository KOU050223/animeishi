// 観測イベントに付ける共通タグのキー名。
// runtime は workers / hermes / browser 等の実行基盤、platform は
// ios / android / web 等の端末側の区別に使う。
export const TAG_KEYS = {
  app: "app",
  runtime: "runtime",
  platform: "platform",
  feature: "feature",
  errorKind: "error.kind",
  requestId: "requestId",
} as const;

// エラーの分類。アラート条件やダッシュボードでの絞り込みに使う。
export type ErrorKind = "auth" | "annict" | "db" | "validation" | "upstream" | "unknown";
