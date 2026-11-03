// 名刺の「完成」の定義と判定（issue #419 と共通。issue #412 の
// オンボーディングでも「名刺完成」画面の進捗表示に使う）。
// 完成 = アイコン・表示名・推し作品 3 つ・テンプレート選択済みの 4 点が揃うこと。
// #419 の「残り N ステップ」は missing の件数と一致する。
//
// このモジュールは純関数だけを置く。React / AsyncStorage / API に触れる
// 取得側は useMeishiCompletion.ts に分離し、ここは vitest（node 環境）で
// そのままテストできるようにする。

import type { TranslationKey } from "@/lib/i18n/keys";
import type { MeishiDocument } from "./types";

// 「推し作品」の必要数。完成の定義の一部なので変更時は #419 の表示も変わる。
export const MEISHI_REQUIRED_FAVORITES = 3;

export type MeishiCompletionStep =
  | "avatar"
  | "displayName"
  | "favorites"
  | "template";

// チェックリスト表示（オンボーディング #412・ホームの完成度カード #419）で
// 共通に使うステップの表示順と表示名。
export const MEISHI_COMPLETION_STEPS: readonly MeishiCompletionStep[] = [
  "avatar",
  "displayName",
  "favorites",
  "template",
];

export const MEISHI_COMPLETION_STEP_LABELS: Record<
  MeishiCompletionStep,
  TranslationKey
> = {
  avatar: "アイコン",
  displayName: "表示名",
  favorites: "推し作品 3 件",
  template: "テンプレート",
};

export type MeishiCompletionInput = {
  /** users.profile_image_url（アバター未設定は null/空文字）。 */
  profileImageUrl?: string | null;
  /** users.username（表示名）。 */
  username?: string | null;
  /** お気に入り（推し）の登録数。 */
  favoritesCount: number;
  /**
   * 既定カード（issue #427 の名刺ライブラリ）のドキュメント。
   * 未作成（テンプレート未選択）は null。
   */
  document: MeishiDocument | null | undefined;
};

/** 完成に足りない項目を列挙する。空配列なら完成。 */
export function missingMeishiCompletionSteps(
  input: MeishiCompletionInput,
): MeishiCompletionStep[] {
  const missing: MeishiCompletionStep[] = [];
  if (!input.profileImageUrl?.trim()) missing.push("avatar");
  if (!input.username?.trim()) missing.push("displayName");
  if (input.favoritesCount < MEISHI_REQUIRED_FAVORITES) {
    missing.push("favorites");
  }
  if (!input.document) missing.push("template");
  return missing;
}

export function isMeishiComplete(input: MeishiCompletionInput): boolean {
  return missingMeishiCompletionSteps(input).length === 0;
}
