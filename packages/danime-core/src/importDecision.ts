// dアニメ取り込みで既存ステータスを上書きするかの判定（issue #374）。
//
// ユーザーが Annict / Animeishi 上で明示的に付けた「視聴済・一時停止・断念」は
// 取り込みで変更しない。dアニメで見返した作品が「視聴中」へ戻ったり、
// 自分で止めた作品が再有効化されたりするのを防ぐため、クライアントの
// レビュー画面と API の bulk 登録の両方がこの判定を使う。

/** 取り込みで上書きしない Annict ステータス。 */
export const DANIME_IMPORT_PROTECTED_STATES = [
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
] as const;

export type DanimeImportAction =
  /** 登録を進めてよい（未登録・視聴予定からの前進・視聴中→視聴済など）。 */
  | "apply"
  /** 既に同じステータスが登録されている（再登録する意味がない）。 */
  | "same_state"
  /** 視聴済・一時停止・断念なので取り込みでは変更しない。 */
  | "protected_state"
  /** 現在のステータスが不明（履歴未取得）。降格し得るため保留する。 */
  | "current_state_unknown";

/**
 * @param targetState 取り込みで登録しようとしているステータス
 * @param currentState 現在の Annict ステータス。未登録は null、
 *   未取得・不明（クライアントの履歴クエリ失敗など）は undefined。
 */
export function decideDanimeImport(
  targetState: string,
  currentState: string | null | undefined,
): DanimeImportAction {
  if (currentState === undefined) {
    // 現状不明のまま WATCHING を登録すると、実は保護対象だった作品を
    // 降格させ得るため保留する。WATCHED 登録は降格にならないので通す。
    return targetState === "WATCHING" ? "current_state_unknown" : "apply";
  }
  if (currentState === targetState) return "same_state";
  if (currentState !== null && isDanimeImportProtectedState(currentState)) {
    return "protected_state";
  }
  return "apply";
}

export function isDanimeImportProtectedState(state: string): boolean {
  return (DANIME_IMPORT_PROTECTED_STATES as readonly string[]).includes(state);
}
