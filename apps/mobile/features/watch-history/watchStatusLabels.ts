// Annict の視聴ステータス → 表示ラベル。視聴履歴 UI と活動フィード文の両方が
// 使うため、Expo / React Query に依存しない純モジュールに置く（vitest の
// *.unit.test.ts からも直接 import できるようにするため）。
export const WATCH_STATUS_LABELS = {
  WATCHING: "視聴中",
  WATCHED: "視聴済",
  ON_HOLD: "一時停止",
  STOP_WATCHING: "断念",
  WANNA_WATCH: "視聴予定",
} as const;

export type WatchState = keyof typeof WATCH_STATUS_LABELS;
