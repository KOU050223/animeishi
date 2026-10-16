// UI イベント計測のクライアント側レート制限（issue #214）。
// Sentry Logs は Developer 無料プランの枠を使うため、連打・ループ・異常系で
// 計測イベントが無料枠を食い潰してエラー監視まで止まらないよう、
// 同一イベント名あたりの送信回数に上限を設ける。

// 既定値。同一イベント名は 1 分あたり maxPerWindow 回まで送る。
export const EVENT_RATE_LIMIT = {
  windowMs: 60_000,
  maxPerWindow: 10,
} as const;

// イベント名ごとの送信タイムスタンプを保持し、直近 windowMs 内の回数が
// 上限を超えたら新規送信を拒否する簡易リミッター。
// 上限到達時は静かに捨てる（「レート制限に達した」イベント自体を送ると
// それがまた枠を消費するため）。
export class EventRateLimiter {
  private readonly timestamps = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow: number = EVENT_RATE_LIMIT.maxPerWindow,
    private readonly windowMs: number = EVENT_RATE_LIMIT.windowMs,
  ) {}

  // 送信を許可するか。許可した分はここで記録する。
  shouldAllow(name: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.timestamps.get(name) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxPerWindow) {
      this.timestamps.set(name, recent);
      return false;
    }
    recent.push(now);
    this.timestamps.set(name, recent);
    return true;
  }

  reset(): void {
    this.timestamps.clear();
  }
}
