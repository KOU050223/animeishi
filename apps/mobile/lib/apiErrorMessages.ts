import i18next from "i18next";
import type { TranslationKey } from "@/lib/i18n/keys";

// API エラー応答の code から利用者向け表示文言（翻訳キー）を引く対応表（issue #838）。
// サーバーの error は開発者向け英語なので画面には出さず、code からクライアント側の
// 翻訳済み文言を引く。表に無い（未知の）code は undefined を返し、呼び出し側の
// 汎用文言にフォールバックする。
const API_ERROR_MESSAGE_KEYS = {
  // edge のユーザー単位流量制限（issue #715）。複数エンドポイント共通。
  rate_limited: "リクエストが多すぎます。しばらくしてからお試しください",
  duplicate_target: "同じユーザーへの通報は24時間に1回までです",
  hourly_limit:
    "通報の送信回数が上限に達しました。しばらくしてから再度お試しください",
  generation_limit:
    "試行回数が上限に達しました。しばらくしてからお試しください",
  annict_token_required: "Annict 連携が必要です",
  image_too_large: "画像サイズが大きすぎます",
  invalid_image_format: "対応していない画像形式です",
  meishi_asset_limit: "アップロードできる画像数の上限に達しました",
} satisfies Record<string, TranslationKey>;

/** code に対応する表示文言の翻訳キーを返す。対応が無ければ undefined。 */
export function apiErrorMessageKey(
  code: string | undefined,
): TranslationKey | undefined {
  if (!code) return undefined;
  return (API_ERROR_MESSAGE_KEYS as Record<string, TranslationKey>)[code];
}

/** code に対応する表示文言（翻訳済み）を返す。対応が無ければ undefined。 */
export function apiErrorMessage(code: string | undefined): string | undefined {
  const key = apiErrorMessageKey(code);
  // i18next 未初期化の環境（単体テスト等）では t() が undefined を返し得る。
  // その場合はキー（ja 文言）をそのまま返す。
  return key ? (i18next.t(key) ?? key) : undefined;
}
