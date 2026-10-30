// 1 リクエストあたりのサブリクエスト予算（issue #219）。
//
// Cloudflare Workers のサブリクエスト上限（Free プラン 50/req）は
// 外部 fetch だけでなく D1・KV 等のバインディング呼び出しも数える。
// 照合（D1 キャッシュ検索＋ Annict 検索＋リトライ）に使う回数を
// この予算で頭打ちにし、超えそうなら検索を諦めて pending に回す。
//
// 照合以外のサブリクエスト（認証・Annict トークン解決の D1 クエリ、
// Clerk の JWKS 取得、障害時の Discord Webhook + KV、Sentry 送信）は
// 予算の外に余裕を持たせるため、予算は上限 50 より小さく取る。

// 照合フェーズが使えるサブリクエスト数。
// 残り ~10 はミドルウェアの D1（~3）・Clerk（~1）・障害通知（KV+Webhook で ~3）・
// Sentry（~1）・マージンに割り当てる。
export const MATCH_SUBREQUEST_BUDGET = 40;

export type SubrequestBudget = {
  /** 1 回分のサブリクエストを消費する。残りが無ければ false。 */
  tryConsume(): boolean;
  /** 残り回数（観測・ログ用）。 */
  readonly remaining: number;
};

export function createSubrequestBudget(limit: number): SubrequestBudget {
  let remaining = limit;
  return {
    tryConsume() {
      if (remaining <= 0) return false;
      remaining--;
      return true;
    },
    get remaining() {
      return remaining;
    },
  };
}
