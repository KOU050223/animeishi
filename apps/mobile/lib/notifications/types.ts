/**
 * 通知権限リクエストの共通インターフェース（issue #412 オンボーディング）。
 * 通知配信の基盤（トークン登録・購読管理）は issue #410 のスコープ。
 * ここでは OS の権限ダイアログを出すことだけを抽象化する。
 */

export type NotificationPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined";

/**
 * OS の通知権限ダイアログを出し、結果を返す。
 * 「あとで」側の進行制御は呼び出し側が持つため、denied でも throw しない。
 */
export type RequestNotificationPermission =
  () => Promise<NotificationPermissionStatus>;
