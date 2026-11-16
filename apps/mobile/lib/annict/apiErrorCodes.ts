// API が返す Annict 起因のエラー code の判定（純関数）。画面側の出し分けと
// useAnnictTokenErrorPrompt で共有する。コードの意味は tokenErrorPrompt.ts 冒頭と
// apps/api/src/lib/annict/errors.ts を参照。
import { ApiRequestError } from "@/lib/apiError";

const ANNICT_TOKEN_ERROR_CODES: ReadonlySet<string> = new Set([
  "annict_token_required",
  "annict_token_invalid",
  "annict_shared_token_unavailable",
]);

/** API エラーが Annict トークンの未登録・失効（共用トークンを含む）によるものか判定する。 */
export function isAnnictTokenError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code !== undefined &&
    ANNICT_TOKEN_ERROR_CODES.has(error.code)
  );
}

/** API エラーが Annict のレート制限（annict_rate_limited）によるものか判定する。 */
export function isAnnictRateLimitedError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.code === "annict_rate_limited"
  );
}
