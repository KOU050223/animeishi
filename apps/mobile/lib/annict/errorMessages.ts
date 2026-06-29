import type { TranslationKey } from "@/lib/i18n/keys";

/**
 * Annict 連携フローの失敗理由（AnnictConnectResult.reason）を i18n キーへ対応づける。
 * 連携 UI（AnnictConnectionCard / AnnictSoftGate）で共通利用する。
 */
export function annictErrorKey(reason: string): TranslationKey {
  switch (reason) {
    // ユーザーが Annict 側で権限付与を拒否した場合。想定外エラーではなくキャンセル扱い。
    case "access_denied":
      return "annict.errors.cancelled";
    case "not_configured":
      return "annict.errors.notConfigured";
    case "state_mismatch":
      return "annict.errors.stateMismatch";
    case "exchange_failed":
    case "browser_failed":
    case "unauthorized":
      return "annict.errors.exchangeFailed";
    default:
      return "annict.errors.unexpected";
  }
}
