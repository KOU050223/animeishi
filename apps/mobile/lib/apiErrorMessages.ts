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
  // プロフィール更新のバリデーション（issue #838）。従来サーバーが返していた
  // 日本語文言と同じキーを引く。
  username_required: "ユーザー名を入力してください",
  username_too_short: "ユーザー名は2文字以上で入力してください",
  username_too_long: "ユーザー名は20文字以内で入力してください",
  username_invalid_chars: "ユーザー名に使用できない文字が含まれています",
  username_reserved: "別のユーザー名を選択してください",
  comment_too_long: "コメントは500文字以内で入力してください",
  inappropriate_content: "不適切な内容が含まれています",
  duplicate_genre: "ジャンルが重複しています",
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
