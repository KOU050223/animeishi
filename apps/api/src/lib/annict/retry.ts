// Annict API 呼び出しのリトライ。並列化した検索・登録で 429（レート制限）や
// 一時的な上流障害（5xx）・通信失敗（status 0）を拾い、決め打ちの回数だけ
// バックオフして再試行する。401（トークン失効・スコープ不足）や 4xx は
// 再試行しても結果が変わらないため即座に投げる。
import { AnnictApiError } from "./client";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

function isRetriable(err: unknown): err is AnnictApiError {
  return (
    err instanceof AnnictApiError &&
    (err.status === 0 || err.status === 429 || err.status >= 500)
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AnnictRetryOptions = {
  /** 初回を含む最大試行回数（既定: 3）。 */
  maxAttempts?: number;
  /** attempt（1 始まりのリトライ回数）ごとに呼ばれる観測用フック。 */
  onRetry?: (err: AnnictApiError, attempt: number) => void;
  /** テスト用に差し替え可能なスリープ。 */
  sleep?: (ms: number) => Promise<void>;
};

export async function withAnnictRetry<T>(
  fn: () => Promise<T>,
  options: AnnictRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable(err)) throw err;
      attempt++;
      if (attempt >= maxAttempts) throw err;
      options.onRetry?.(err, attempt);
      await sleep(DEFAULT_BASE_DELAY_MS * attempt);
    }
  }
}
