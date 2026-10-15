import * as Sentry from "@sentry/cloudflare";
import {
  buildRelease,
  resolveEnvironment,
  sanitizeHeaders,
  TAG_KEYS,
  type ErrorKind,
} from "@animeishi/observability";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AnnictApiError } from "@/lib/annict/client";
import { annictErrorResponse } from "@/lib/annict/errors";
import { DeletedUserError } from "@/features/users/repository";

// Sentry 初期化に必要なバインディング。
// SENTRY_DSN は Workers Secret、ENVIRONMENT は wrangler.toml [vars]、
// CF_VERSION_METADATA は version_metadata バインディングから供給される。
export type ObservabilityBindings = {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
};

// withSentry へ渡す初期化オプション。SENTRY_DSN 未設定のローカル・
// テスト環境では enabled:false で SDK 全体を no-op にする。
export function buildSentryOptions(
  env: ObservabilityBindings,
): Sentry.CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: resolveEnvironment(env.ENVIRONMENT),
    release: buildRelease("api", env.CF_VERSION_METADATA?.id ?? "dev"),
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      httpHeaders: { request: { deny: ["x-annict-token"] } },
    },
    beforeSend: (event) => finalizeEvent(event),
  };
}

// 送信直前のイベント整形。共通タグ・error.kind の付与と
// ヘッダ/body の sanitize を一箇所で行い、withSentry の自動 capture と
// captureApiError の手動 capture の両方に効かせる。
function finalizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  event.tags = {
    ...event.tags,
    [TAG_KEYS.app]: "animeishi-api",
    [TAG_KEYS.runtime]: "workers",
    [TAG_KEYS.errorKind]: classifyEvent(event),
  };
  if (event.request) {
    if (event.request.headers) {
      event.request = {
        ...event.request,
        headers: sanitizeHeaders(event.request.headers),
      };
    }
    delete event.request.data;
  }
  return event;
}

// exception のクラス名・メッセージから error.kind を推定する。
function classifyEvent(event: Sentry.ErrorEvent): ErrorKind {
  const value = event.exception?.values?.[0];
  const type = value?.type ?? "";
  const message = value?.value ?? "";
  if (type === "AnnictApiError") return "annict";
  if (type === "ZodError") return "validation";
  const haystack = `${type} ${message}`;
  if (/\bD1_|sqlite/i.test(haystack)) return "db";
  if (/clerk|unauthorized/i.test(haystack)) return "auth";
  return "unknown";
}

// 明示的に例外を Sentry へ送る。requestId と route / method を
// タグ・コンテキストに載せる。breadcrumb は別途積まずこの最小セットで代替する。
export function captureApiError(err: unknown, c: Context): void {
  Sentry.withScope((scope) => {
    const requestId = c.get("requestId");
    if (requestId) {
      scope.setTag(TAG_KEYS.requestId, requestId);
    }
    scope.setContext("request", {
      route: c.req.routePath,
      method: c.req.method,
      path: c.req.path,
    });
    Sentry.captureException(err);
  });
}

// ユーザー通報を運営通知として Sentry に送る。
// アプリ側に Discord Webhook を持たない方針（docs/08_observability-design.md）
// のため、Sentry Alert 経由の Discord 通知に乗せる。
// captureMessage のタイトルは固定なので、fingerprint で通報対象ユーザーごとに
// Issue を分ける（「新規 Issue」トリガーの Discord アラートが初回通報で
// しか飛ばないのを防ぐ）。report.reported_user_id タグで検索もできる。
// SENTRY_DSN 未設定の環境では SDK が no-op になり通知は送られない。
export function notifyUserReport(
  c: Context,
  input: { reporterId: string; reportedUserId: string; reason: string },
): void {
  Sentry.withScope((scope) => {
    const requestId = c.get("requestId");
    if (requestId) {
      scope.setTag(TAG_KEYS.requestId, requestId);
    }
    scope.setFingerprint(["user_report", input.reportedUserId]);
    scope.setTag("report.reported_user_id", input.reportedUserId);
    scope.setContext("user_report", input);
    Sentry.captureMessage("user_report_received", "warning");
  });
}

// Hono の app.onError 本体。分類・送信可否・応答整形をここに集約する。
// ユーザー要因（HTTPException <500、AnnictApiError の 401）は Sentry に送らない。
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      captureApiError(err, c);
    }
    return err.getResponse();
  }
  if (err instanceof AnnictApiError) {
    // ユーザーが再連携で解決できる 401（トークン失効）だけ送らない。
    // status には上流の HTTP ステータスがそのまま入るため、200 の
    // GraphQL エラーや不正 JSON、429（レート制限）もクライアントには
    // 502 として返る障害であり、ここで記録する。
    if (err.status !== 401) {
      captureApiError(err, c);
    }
    return annictErrorResponse(c, err) ?? internalError(c);
  }
  if (err instanceof DeletedUserError) {
    // 削除済みユーザーの残存 JWT による書き込み（issue #144）。
    // requireAuth 通過後に DELETE /me が割り込んだ race で到達する。
    // ユーザー要因なので Sentry には送らず 401 を返す。
    return c.json({ error: "Unauthorized" }, 401);
  }
  captureApiError(err, c);
  return internalError(c);
}

function internalError(c: Context): Response {
  return c.json(
    {
      error: "サーバーエラーが発生しました",
      code: "internal_error",
      requestId: c.get("requestId"),
    },
    500,
  );
}
