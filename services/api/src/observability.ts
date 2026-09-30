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

// Hono の app.onError 本体。分類・送信可否・応答整形をここに集約する。
// 4xx 相当（HTTPException <500、AnnictApiError の 4xx 系）は Sentry に送らない。
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      captureApiError(err, c);
    }
    return err.getResponse();
  }
  if (err instanceof AnnictApiError) {
    // 通信失敗(0)・5xx 系は上流障害として記録する。
    // 401 トークン失効など 4xx 系はユーザー・連携要因なので送らない。
    if (err.status === 0 || err.status >= 500) {
      captureApiError(err, c);
    }
    return annictErrorResponse(c, err) ?? internalError(c);
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
