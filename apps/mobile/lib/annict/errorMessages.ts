import type { TranslationKey } from "@/lib/i18n/keys";

/**
 * Annict 連携フローの失敗理由（AnnictConnectResult.reason）を i18n キーへ対応づける。
 * 連携 UI（AnnictConnectionCard / AnnictSoftGate）で共通利用する。
 */
export function annictErrorKey(reason: string): TranslationKey {
  switch (reason) {
    // ユーザーが Annict 側で権限付与を拒否した場合。想定外エラーではなくキャンセル扱い。
    case "access_denied":
      return "連携をキャンセルしました";
    case "not_configured":
      return "Annict 連携が構成されていません";
    case "state_mismatch":
      return "認証情報が一致しませんでした。もう一度お試しください";
    case "exchange_failed":
    case "browser_failed":
    case "unauthorized":
      return "Annict 連携に失敗しました。もう一度お試しください";
    default:
      return "予期しないエラーが発生しました";
  }
}
