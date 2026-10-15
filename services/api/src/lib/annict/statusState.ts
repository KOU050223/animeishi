// Annict の StatusState enum と Animeishi の watch_history.state の対応。
//
// PR2 時点では両者の値は完全一致（Annict 値をそのまま D1 に持つ設計）だが、
// 「Annict から来た値が D1 で扱う 5 値のいずれかであること」を保証する境界を
// 1 箇所に集約しておく。NO_STATE（未設定）は D1 には保存しないため弾く。

// D1 に保存可能な Annict StatusState（NO_STATE は除く）。
// バリデーション側（features/watch-history/schema.ts）もこの定義を使う。
export const ANNICT_STATUS_STATES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

export type AnnictStatusState = (typeof ANNICT_STATUS_STATES)[number];

// Annict が返しうる StatusState（NO_STATE を含む全値）。
// libraryEntries / updateStatus のレスポンス検証に使う。
export const ANNICT_ALL_STATUS_STATES = [
  "NO_STATE",
  ...ANNICT_STATUS_STATES,
] as const;

export type AnnictAllStatusState = (typeof ANNICT_ALL_STATUS_STATES)[number];

const PERSISTABLE = new Set<string>(ANNICT_STATUS_STATES);

/**
 * Annict の StatusState 文字列が D1 に保存可能な 5 値かを判定する。
 * NO_STATE や未知の値は false。
 */
export function isPersistableState(
  state: string | null | undefined,
): state is AnnictStatusState {
  return state != null && PERSISTABLE.has(state);
}
