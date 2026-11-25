/**
 * API が 4xx / 5xx を返したときに投げるエラー。
 * HTTP ステータスを保持するため、Sentry 側の beforeSend で
 * 「4xx（ユーザー起因）は issue にしない / 5xx（サーバー障害）は送る」
 * というポリシーを適用できる。判定ロジックは lib/observability.ts。
 */
export class ApiRequestError extends Error {
  readonly status: number;
  /** エラーレスポンス JSON の code（annict_upstream 等）。無ければ undefined。 */
  readonly code: string | undefined;
  /** 429 等でサーバーが指定した再試行までの秒数（Retry-After ヘッダ）。無ければ undefined。 */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    message: string,
    code?: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * エラーレスポンスの JSON 本文から `code` を取り出す。
 * 本文が JSON でない（WAF の HTML 応答等）・`code` を含まない場合は undefined。
 * hono client の ClientResponse は DOM の Response 型とは別物なので、
 * 必要な `json()` だけを持つ構造型で受ける。
 */
export async function readApiErrorCode(res: {
  json(): Promise<unknown>;
}): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as {
    code?: unknown;
  } | null;
  return typeof body?.code === "string" ? body.code : undefined;
}

/**
 * 429 応答の Retry-After ヘッダを秒数で取り出す。
 * API は秒数のみを返す（HTTP 日付形式は扱わない）。ヘッダが無い・
 * 数値でない場合は undefined。
 */
export function readRetryAfterSeconds(res: {
  headers: { get(name: string): string | null };
}): number | undefined {
  const value = res.headers.get("Retry-After");
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : undefined;
}
