/**
 * API が 4xx / 5xx を返したときに投げるエラー。
 * HTTP ステータスを保持するため、Sentry 側の beforeSend で
 * 「4xx（ユーザー起因）は issue にしない / 5xx（サーバー障害）は送る」
 * というポリシーを適用できる。判定ロジックは lib/observability.ts。
 */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}
