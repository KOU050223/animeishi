/**
 * 一過性の D1 internal error（"D1_ERROR: internal error; reference = ..."）
 * かどうか。drizzle が包む DrizzleQueryError の cause もたどって判定する。
 */
export function isD1InternalError(err: unknown): boolean {
  for (let cur: unknown = err; cur instanceof Error; cur = cur.cause) {
    if (/d1_error:?\s*internal error/i.test(cur.message)) return true;
  }
  return false;
}

/**
 * 一過性の D1 internal error で失敗したら 1 回だけ実行し直す。
 * それ以外のエラーはそのまま投げる（D1 のガイドでも internal error は
 * リトライ可・それ以外はリトライしても直らない前提のため）。
 */
export async function withD1InternalErrorRetry<T>(
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (!isD1InternalError(err)) throw err;
    return task();
  }
}
