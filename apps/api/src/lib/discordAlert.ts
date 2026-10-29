// 重大な API 障害・cron 失敗・ユーザー通報の Discord 通知。
// Sentry の無料（Developer）プランでは Discord を通知先にしたアラートルールが
// 作れないため、Worker から Webhook へ直接送る。
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
  const webhookUrl = resolveWebhookUrl(env);
  if (!webhookUrl) return false;
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
  return postAlert(webhookUrl, lines.join("\n"), fetchImpl);
}

// cron ジョブの失敗通知（issue #233）。一過性の単発失敗では送らず、
// 連続 CRON_FAILURE_THRESHOLD 回失敗したときだけ送る。
// 連続回数は ALERT_STATE の `cron_fail_count:<job>` に保持し、
// ジョブが成功したら clearCronFailures で消す（成功は通知しない）。
// 通知の重複は API 障害と同じ印方式で抑える（キーは `cron:<job>`）。
export const CRON_FAILURE_THRESHOLD = 2;

// 連続失敗カウントの保持期限。失敗のたびに TTL が延びるため、障害中に
// 切れることはない。成功・ジョブ廃止で消えない残骸だけ期限切れに任せる。
const CRON_FAIL_COUNT_TTL_SECONDS = 24 * 60 * 60;

export async function notifyCronFailure(
  env: AlertBindings,
  job: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const webhookUrl = resolveWebhookUrl(env);
  if (!webhookUrl) return false;
  const consecutive = await recordCronFailure(env, job);
  if (consecutive < CRON_FAILURE_THRESHOLD) return false;
  const key = `cron:${job}`;
  const now = Date.now();
  if ((localSuppressedUntil.get(key) ?? 0) > now) return false;
  localSuppressedUntil.set(key, now + SUPPRESS_SECONDS * 1000);
  if (await isSuppressed(env, key)) return false;
  // 送信前に印を付ける（API 障害と同じく連投しない方を優先する）。
  await markSent(env, key);
  return postAlert(
    webhookUrl,
    [
      `🔴 **[animeishi-api${envLabel(env.ENVIRONMENT)}] cron 障害**`,
      `\`cron:${job}\` が ${consecutive} 回連続で失敗`,
      `詳細は Sentry を確認。同じ障害の通知は${SUPPRESS_SECONDS / 60}分止めます。`,
    ].join("\n"),
    fetchImpl,
  );
}

// ジョブの成功で連続失敗カウントを消す。成功自体は通知しない。
// カウントが残っているときだけ KV を消す — 成功ごとに無条件 delete すると
// cron 間隔（10 分 × 2 ジョブ）で KV の書き込み無料枠を食い潰すため。
// この isolate が失敗を記録していれば残っていると分かるので get を省き、
// それ以外は get で確認する（get の無料枠は書き込みより大きい）。
// KV は結果整合なので、別 isolate が直前に書いた/消したカウントを
// 読み飛ばすことはある（cron 間隔に対して伝播遅延は十分小さく厳密さは不要）。
export async function clearCronFailures(
  env: AlertBindings,
  job: string,
): Promise<void> {
  const key = cronFailCountKey(job);
  const hadLocal = localCronFailures.delete(key);
  if (!env.ALERT_STATE) return;
  if (!hadLocal) {
    try {
      if ((await env.ALERT_STATE.get(key)) === null) return;
    } catch (err) {
      logAlertFailure("kv_get", err instanceof Error ? err.name : "Error");
      return;
    }
  }
  try {
    await env.ALERT_STATE.delete(key);
  } catch (err) {
    logAlertFailure("kv_delete", err instanceof Error ? err.name : "Error");
  }
}

// ユーザー通報の通知（issue #232）。通報者・被通報者の ID や通報理由は
// 本文に入れず、「通報あり」と直近の件数だけを送る。詳細は
// pnpm task reports:list で確認する運用。
// 通報は 1 件ずつ気づきたいので抑止間隔は障害通知（SUPPRESS_SECONDS）より短い
// REPORT_SUPPRESS_SECONDS。抑止中に届いた通報は送らず件数だけ
// `user_report_pending` に積み、次の通知に「直近 N 件」として載せる。
// 件数は ALERT_STATE を正とし、KV 未バインド・読み書き失敗時は
// isolate 内メモリで数える（cron の連続失敗カウントと同じ考え方）。
export const REPORT_SUPPRESS_SECONDS = 5 * 60;

const REPORT_ALERT_KEY = "user_report";
const REPORT_PENDING_KEY = "user_report_pending";

// 積んだ件数の保持期限。抑止窓（5 分）より十分長くして次の通知まで残す。
// 通知が来ないまま残った残骸は期限切れに任せる。
const REPORT_PENDING_TTL_SECONDS = 24 * 60 * 60;

export async function notifyUserReport(
  env: AlertBindings,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const webhookUrl = resolveWebhookUrl(env);
  if (!webhookUrl) return false;
  const now = Date.now();
  // await より前に同期でメモリの印を確認・設定し、同時に走った通知同士の重複を防ぐ。
  if ((localSuppressedUntil.get(REPORT_ALERT_KEY) ?? 0) <= now) {
    localSuppressedUntil.set(
      REPORT_ALERT_KEY,
      now + REPORT_SUPPRESS_SECONDS * 1000,
    );
    if (!(await isSuppressed(env, REPORT_ALERT_KEY))) {
      // 送信前に印を付ける。送信に失敗して次の通報で再送されるより、
      // 連投しない方を優先する（API 障害と同じ考え方）。
      await markSent(env, REPORT_ALERT_KEY, REPORT_SUPPRESS_SECONDS);
      const pending = await drainPendingReports(env);
      return postAlert(
        webhookUrl,
        [
          `🔔 **[animeishi-api${envLabel(env.ENVIRONMENT)}] ユーザー通報**`,
          `新しい通報がありました${pending > 0 ? `（直近 ${pending + 1} 件）` : ""}。`,
          `詳細は \`pnpm task reports:list\` で確認。同じ通知は${REPORT_SUPPRESS_SECONDS / 60}分止めます。`,
        ].join("\n"),
        fetchImpl,
      );
    }
  }
  // 抑止中に届いた分は件数だけ積み、次の通知に載せる。
  await recordPendingReport(env);
  return false;
}

// isolate 内の印（キー → 抑止の期限 ms）。KV の結果整合を補うだけのもの。
const localSuppressedUntil = new Map<string, number>();

// isolate 内の連続失敗カウント（カウントキー → 回数）。
// ALERT_STATE 未バインド・KV 読み書き失敗時の退避先。
const localCronFailures = new Map<string, number>();

// isolate 内の、KV に書けなかった通報の積算件数。ALERT_STATE 未バインド・
// KV 読み書き失敗時の退避先（KV に書けた分は KV だけが持つ）。
let localPendingReports = 0;

// テスト間で isolate 内の印と各カウントを消す。
export function resetLocalSuppression(): void {
  localSuppressedUntil.clear();
  localCronFailures.clear();
  localPendingReports = 0;
}

function cronFailCountKey(job: string): string {
  return `cron_fail_count:${job}`;
}

// 連続失敗回数を 1 増やして返す。カウントは ALERT_STATE を正とする
// （isolate 内メモリを正にすると、別 isolate の成功によるリセットを
// 古い値で上書きしてしまう）。未バインド・get 失敗時だけメモリで数える。
// 結果整合で直前の成功（delete）を読み飛ばす余地は残るが、cron 間隔
// （10 分）に対して KV の伝播遅延は十分小さい。
async function recordCronFailure(
  env: AlertBindings,
  job: string,
): Promise<number> {
  const key = cronFailCountKey(job);
  if (env.ALERT_STATE) {
    try {
      const stored = Number((await env.ALERT_STATE.get(key)) ?? 0) || 0;
      const count = stored + 1;
      localCronFailures.set(key, count);
      try {
        await env.ALERT_STATE.put(key, String(count), {
          expirationTtl: CRON_FAIL_COUNT_TTL_SECONDS,
        });
      } catch (err) {
        logAlertFailure("kv_put", err instanceof Error ? err.name : "Error");
      }
      return count;
    } catch (err) {
      logAlertFailure("kv_get", err instanceof Error ? err.name : "Error");
    }
  }
  const count = (localCronFailures.get(key) ?? 0) + 1;
  localCronFailures.set(key, count);
  return count;
}

// 抑止中に届いた通報を 1 件積む。カウントは ALERT_STATE を正とし、
// isolate 内メモリには KV に書けなかった分（未バインド・読み書き失敗）
// だけを積む —— KV に書けた分までメモリに残すと、別 isolate が
// ドレインした後に古い件数を二重計上してしまうため。
async function recordPendingReport(env: AlertBindings): Promise<void> {
  if (env.ALERT_STATE) {
    try {
      const stored =
        Number((await env.ALERT_STATE.get(REPORT_PENDING_KEY)) ?? 0) || 0;
      try {
        await env.ALERT_STATE.put(REPORT_PENDING_KEY, String(stored + 1), {
          expirationTtl: REPORT_PENDING_TTL_SECONDS,
        });
        return;
      } catch (err) {
        logAlertFailure("kv_put", err instanceof Error ? err.name : "Error");
      }
    } catch (err) {
      logAlertFailure("kv_get", err instanceof Error ? err.name : "Error");
    }
  }
  localPendingReports += 1;
}

// 通知に載せる積算件数を取り出してリセットする。
// KV の件数と、KV に書けずメモリに退避した分を合算して返す。
async function drainPendingReports(env: AlertBindings): Promise<number> {
  const local = localPendingReports;
  localPendingReports = 0;
  if (env.ALERT_STATE) {
    try {
      const stored =
        Number((await env.ALERT_STATE.get(REPORT_PENDING_KEY)) ?? 0) || 0;
      if (stored > 0) {
        try {
          await env.ALERT_STATE.delete(REPORT_PENDING_KEY);
        } catch (err) {
          // delete だけ失敗すると次の通知で同じ件数を再計上する。
          // 通知 1 回分の誤差に留まるため許容し、自然失効（TTL）に任せる。
          logAlertFailure(
            "kv_delete",
            err instanceof Error ? err.name : "Error",
          );
        }
      }
      return stored + local;
    } catch (err) {
      // get 失敗時は KV の件数が分からない。消しにいかず残しておけば
      // 次の通知で数え直せるため、今回はメモリ分だけ返す。
      logAlertFailure("kv_get", err instanceof Error ? err.name : "Error");
    }
  }
  return local;
}

// DISCORD_WEBHOOK_URL（シークレット）を取り出す。未設定・URL として
// 解釈不能な設定値は通知を諦めるが、「なぜ送られなかったか」が追えるよう
// 理由だけはログに残す。値そのものはシークレットなので出さない
// （issue #219: 通知失敗時に reason: Error だけで原因を追えなかった）。
function resolveWebhookUrl(env: AlertBindings): string | null {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url) {
    logAlertFailure("webhook_config", "not_configured");
    return null;
  }
  try {
    new URL(url);
  } catch {
    logAlertFailure("webhook_config", "invalid_url");
    return null;
  }
  return url;
}

// Webhook への POST 本体。失敗は warn ログだけで false を返す。
async function postAlert(
  webhookUrl: string,
  content: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // メンションを解釈させない（@everyone 等が混ざっても通知を飛ばさない）。
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) logAlertFailure("webhook", String(res.status));
    return res.ok;
  } catch (err) {
    logAlertFailure("webhook", webhookErrorReason(err, webhookUrl));
    return false;
  }
}

// 送信失敗の理由を "ErrorName: message" 形で返す。例外メッセージに
// Webhook URL（シークレット）が埋め込まれた場合に備えて伏せる。
function webhookErrorReason(err: unknown, webhookUrl: string): string {
  if (!(err instanceof Error)) return "Error";
  const message = err.message.split(webhookUrl).join("[webhook_url]");
  return `${err.name}: ${message}`;
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

async function markSent(
  env: AlertBindings,
  key: string,
  ttlSeconds: number = SUPPRESS_SECONDS,
): Promise<void> {
  if (!env.ALERT_STATE) return;
  try {
    await env.ALERT_STATE.put(key, String(Date.now()), {
      expirationTtl: ttlSeconds,
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
