// 重大な API 障害の Discord 通知。Sentry の無料（Developer）プランでは Discord を
// 通知先にしたアラートルールが作れないため、Worker から Webhook へ直接送る。
// DISCORD_WEBHOOK_URL（Workers Secret）が未設定なら何もしない。
//
// 本文に入れるのはルートパターン・メソッド・ステータス・件数だけ。
// エラーメッセージ・ユーザー ID・実際のパス・クエリ文字列は渡さない。
// 障害ごとに ALERT_STATE（KV）へ印を付け、SUPPRESS_SECONDS の間は同じ障害を再送しない
// （何を同じ障害とみなすかは alertKey を参照）。KV は重複を抑えるためだけのもので、
// 読み書きに失敗しても通知は送る（連投より取りこぼしの方が困る）。
// KV は結果整合なので、同じ isolate 内の同時発生（一括更新で何十件も失敗する等）は
// メモリ上の印でも抑える。別 isolate でほぼ同時に失敗すると 2 通届くことはありうる。

// 長引く障害で #bot-log が埋まらない間隔。Sentry 側のアラート間隔（30 分）に揃える。
export const SUPPRESS_SECONDS = 30 * 60;

export type AlertBindings = {
  DISCORD_WEBHOOK_URL?: string;
  ALERT_STATE?: KVNamespace;
  ENVIRONMENT?: string;
};

export type ApiFailure = {
  // error.kind（annict / db / auth / unknown 等）。重複抑止キーに使う。
  kind: string;
  // クライアントへ返したステータス。
  status: number;
  // ルートパターン（例: /me/annict/sync, /user/:uid）。実際のパスは渡さない。
  route: string;
  method: string;
};

export async function notifyApiFailures(
  env: AlertBindings,
  failures: ApiFailure[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.DISCORD_WEBHOOK_URL) return false;
  // await より前に同期でメモリの印を確認・設定し、同時に走った通知同士の重複を防ぐ。
  const now = Date.now();
  const candidates = groupFailures(failures).filter((group) => {
    const key = alertKey(group.failure);
    if ((localSuppressedUntil.get(key) ?? 0) > now) return false;
    localSuppressedUntil.set(key, now + SUPPRESS_SECONDS * 1000);
    return true;
  });
  const fresh: { failure: ApiFailure; count: number }[] = [];
  for (const group of candidates) {
    if (!(await isSuppressed(env, alertKey(group.failure)))) fresh.push(group);
  }
  if (fresh.length === 0) return false;
  // 送信前に印を付ける。送信に失敗して次の障害で再送されるより、連投しない方を優先する。
  await Promise.all(fresh.map((g) => markSent(env, alertKey(g.failure))));

  const lines = [
    `🔴 **[animeishi-api${envLabel(env.ENVIRONMENT)}] API 障害**`,
    ...fresh.map(
      ({ failure, count }) =>
        `\`${failure.method} ${failure.route}\` → ${failure.status}（${failure.kind}）${count > 1 ? ` ×${count}` : ""}`,
    ),
    `詳細は Sentry を確認。同じ障害の通知は${SUPPRESS_SECONDS / 60}分止めます。`,
  ];
  try {
    const res = await fetchImpl(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // メンションを解釈させない（@everyone 等が混ざっても通知を飛ばさない）。
      body: JSON.stringify({
        content: lines.join("\n"),
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) logAlertFailure("webhook", String(res.status));
    return res.ok;
  } catch (err) {
    logAlertFailure("webhook", err instanceof Error ? err.name : "Error");
    return false;
  }
}

// isolate 内の印（キー → 抑止の期限 ms）。KV の結果整合を補うだけのもの。
const localSuppressedUntil = new Map<string, number>();

// テスト間で isolate 内の印を消す。
export function resetLocalSuppression(): void {
  localSuppressedUntil.clear();
}

// 外部 API・D1・認証基盤の障害は全ルートに広がるため、種別×ステータスで 1 件にまとめる。
// それ以外（unknown 等）は原因がルートごとに違うことが多いので、ルート単位で印を付け、
// 別ルートの新しい障害を抑止しない。
const SHARED_KINDS = new Set(["annict", "upstream", "db", "auth"]);

export function alertKey(failure: ApiFailure): string {
  const base = `api:${failure.kind}:${failure.status}`;
  return SHARED_KINDS.has(failure.kind)
    ? base
    : `${base}:${failure.method} ${failure.route}`;
}

function envLabel(environment: string | undefined): string {
  return environment && environment !== "production" ? ` ${environment}` : "";
}

// 同じ障害の組み合わせを 1 件にまとめる。キーごとに判定するので、先頭と別の障害が
// 後ろに混ざっていても取りこぼさない。
function groupFailures(
  failures: ApiFailure[],
): { failure: ApiFailure; count: number }[] {
  const byKey = new Map<string, { failure: ApiFailure; count: number }>();
  for (const failure of failures) {
    const key = alertKey(failure);
    const group = byKey.get(key);
    if (group) group.count += 1;
    else byKey.set(key, { failure, count: 1 });
  }
  return [...byKey.values()];
}

async function isSuppressed(env: AlertBindings, key: string): Promise<boolean> {
  if (!env.ALERT_STATE) return false;
  try {
    return (await env.ALERT_STATE.get(key)) !== null;
  } catch (err) {
    logAlertFailure("kv_get", err instanceof Error ? err.name : "Error");
    return false;
  }
}

async function markSent(env: AlertBindings, key: string): Promise<void> {
  if (!env.ALERT_STATE) return;
  try {
    await env.ALERT_STATE.put(key, String(Date.now()), {
      expirationTtl: SUPPRESS_SECONDS,
    });
  } catch (err) {
    logAlertFailure("kv_put", err instanceof Error ? err.name : "Error");
  }
}

function logAlertFailure(op: string, reason: string): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "discord_alert_failed",
      op,
      reason,
    }),
  );
}
