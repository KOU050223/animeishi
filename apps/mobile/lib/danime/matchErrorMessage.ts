// dアニメ照合失敗時のユーザー向け文言（issue #219）。
// API のエラー JSON（{error, code}）をそのまま画面に出さず、code ごとの
// 案内に変換する。レスポンス本文の詳細は useDanimeMatch がコンソールに残す。
import { ApiRequestError } from "@/lib/apiError";

const GENERIC_MESSAGE = "照合に失敗しました。時間をおいて再度お試しください。";

// API 側のエラーレスポンス code（apps/api/src/lib/annict/errors.ts 等）に対応。
const MESSAGES_BY_CODE: Record<string, string> = {
  annict_token_invalid:
    "Annict 連携が無効になっています。設定から連携し直してください。",
  annict_token_required:
    "Annict 連携が無効になっています。設定から連携し直してください。",
  annict_upstream:
    "Annict との通信に失敗しました。時間をおいて再度お試しください。",
  internal_error:
    "サーバーエラーが発生しました。時間をおいて再度お試しください。",
};

export function danimeMatchErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return MESSAGES_BY_CODE[error.code ?? ""] ?? GENERIC_MESSAGE;
  }
  // fetch の reject（通信断）を接続失敗として案内する。
  if (error instanceof TypeError) {
    return "通信に失敗しました。ネットワーク接続を確認して再度お試しください。";
  }
  return error instanceof Error ? error.message : GENERIC_MESSAGE;
}
