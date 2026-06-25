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

/** Clerk のエラーコード → 翻訳キー（auth.errors.* / translation namespace）のマッピング */
const CLERK_ERROR_KEYS: Record<string, TranslationKey> = {
  // 認証情報の誤り
  form_password_incorrect: "auth.errors.invalidCredentials",
  form_identifier_not_found: "auth.errors.invalidCredentials",
  form_param_format_invalid: "auth.errors.invalidFormat",
  form_param_nil: "auth.errors.missingParam",

  // サインアップ時の重複
  form_identifier_exists: "auth.errors.identifierExists",
  form_username_exists: "auth.errors.usernameExists",

  // パスワードポリシー
  form_password_pwned: "auth.errors.passwordPwned",
  form_password_length_too_short: "auth.errors.passwordTooShort",
  form_password_validation_failed: "auth.errors.passwordValidationFailed",

  // 認証コード
  form_code_incorrect: "auth.errors.codeIncorrect",
  verification_expired: "auth.errors.verificationExpired",
  verification_failed: "auth.errors.verificationFailed",

  // セッション・レート制限
  session_exists: "auth.errors.sessionExists",
  rate_limit_exceeded: "auth.errors.rateLimitExceeded",
  too_many_requests: "auth.errors.tooManyRequests",
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
  fallbackKey: TranslationKey = "auth.errors.fallback",
): string {
  const code = extractClerkErrorCode(err);
  const mapped = code ? CLERK_ERROR_KEYS[code] : undefined;
  return i18n.t(mapped ?? fallbackKey);
}
