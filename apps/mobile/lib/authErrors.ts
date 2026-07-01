/**
 * Clerk から返るエラーを、ユーザー向けの日本語メッセージへ変換するユーティリティ。
 *
 * Clerk のエラーは英語のまま返ってくる（例:
 * "We were unable to complete a GET request for this Client..."）ため、
 * そのまま表示すると利用者に意味が伝わらない。
 * エラー文言は変わり得るので、安定している `code` を基準に i18n キーへマッピングする。
 *
 * コンポーネント外（フックを使えない場所）でも呼べるよう、`i18n.t` を直接利用する。
 */
import i18n from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/keys";

/** Clerk のエラーコード → 翻訳キー（= 日本語文言）のマッピング */
const CLERK_ERROR_KEYS: Record<string, TranslationKey> = {
  // 認証情報の誤り
  form_password_incorrect: "メールアドレスまたはパスワードが違います",
  form_identifier_not_found: "メールアドレスまたはパスワードが違います",
  form_param_format_invalid: "入力内容の形式が正しくありません",
  form_param_nil: "必須項目が入力されていません",

  // サインアップ時の重複
  form_identifier_exists: "このメールアドレスは既に登録されています",
  form_username_exists: "このユーザー名は既に使われています",

  // パスワードポリシー
  form_password_pwned:
    "このパスワードは漏洩が確認されています。別のパスワードを設定してください",
  form_password_length_too_short: "パスワードが短すぎます",
  form_password_validation_failed: "パスワードの要件を満たしていません",

  // 認証コード
  form_code_incorrect: "認証コードが正しくありません",
  verification_expired:
    "認証コードの有効期限が切れました。もう一度お試しください",
  verification_failed: "認証に失敗しました。もう一度お試しください",

  // セッション・レート制限
  session_exists: "既にサインインしています",
  rate_limit_exceeded:
    "試行回数が上限に達しました。しばらくしてからお試しください",
  too_many_requests: "リクエストが多すぎます。しばらくしてからお試しください",
};

/** Clerk のエラーオブジェクトから先頭エラーの code を取り出す */
function extractClerkErrorCode(err: unknown): string | undefined {
  if (
    typeof err === "object" &&
    err !== null &&
    "errors" in err &&
    Array.isArray((err as { errors: unknown }).errors)
  ) {
    const first = (err as { errors: Array<unknown> }).errors[0];
    if (
      typeof first === "object" &&
      first !== null &&
      "code" in first &&
      typeof (first as { code: unknown }).code === "string"
    ) {
      return (first as { code: string }).code;
    }
  }
  return undefined;
}

/**
 * 認証エラーをローカライズ済みメッセージへ変換する。
 *
 * @param err          catch で受け取ったエラー
 * @param fallbackKey  マッピングに該当しない場合に使う翻訳キー
 */
export function toAuthErrorMessage(
  err: unknown,
  fallbackKey: TranslationKey = "処理に失敗しました。もう一度お試しください",
): string {
  const code = extractClerkErrorCode(err);
  const mapped = code ? CLERK_ERROR_KEYS[code] : undefined;
  return i18n.t(mapped ?? fallbackKey);
}
