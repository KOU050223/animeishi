// Expo / React Native 側の Sentry 初期化と送信ポリシー。
// 命名・sanitize のルールは @animeishi/observability（API と共有）を使い、
// 設計は docs/08_observability-design.md を参照。
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  buildRelease,
  resolveEnvironment,
  sanitizeHeaders,
  TAG_KEYS,
  type ErrorKind,
} from "@animeishi/observability";
import { ApiRequestError } from "@/lib/apiError";

// Sentry.init に渡すパラメータ。initObservability が
// EXPO_PUBLIC_* 環境変数と app.json の値から組み立てる。
export type ObservabilityEnv = {
  sentryDsn?: string;
  environment?: string;
  appVersion?: string;
};

type BeforeSend = NonNullable<Sentry.ReactNativeOptions["beforeSend"]>;
type MobileEvent = Parameters<BeforeSend>[0];
type MobileHint = Parameters<BeforeSend>[1];

// DSN はクライアントバンドルに埋め込まれる公開値。
// 未設定や eas.json の REPLACE_WITH_* プレースホルダのままでは
// SDK 全体を no-op にし、ローカル開発や未登録の CI を壊さない。
export function isSentryEnabled(dsn: string | undefined): boolean {
  return Boolean(dsn?.startsWith("https://") && dsn.includes("@"));
}

export function buildSentryOptions(
  env: ObservabilityEnv,
): Sentry.ReactNativeOptions {
  return {
    dsn: env.sentryDsn,
    enabled: isSentryEnabled(env.sentryDsn),
    environment: resolveEnvironment(env.environment),
    release: buildRelease("mobile", env.appVersion ?? "dev"),
    // tracing / session replay / profiling はスコープ外（エラー収集のみ）。
    tracesSampleRate: 0,
    // ユーザー情報・IP・cookie などの PII は送らない。
    sendDefaultPii: false,
    beforeSend: (event, hint) => finalizeEvent(event, hint),
  };
}

let initialized = false;

// アプリ起動時に一度だけ呼ぶ。app/_layout.tsx のモジュールスコープから
// 呼び、グローバルエラーハンドラと Sentry.wrap の ErrorBoundary を有効化する。
export function initObservability(): void {
  if (initialized) return;
  initialized = true;
  Sentry.init(
    buildSentryOptions({
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
      appVersion: Constants.expoConfig?.version ?? undefined,
    }),
  );
}

// 送信直前のイベント整形。共通タグ・error.kind の付与、
// ヘッダ/body の sanitize、送信可否の判定を一箇所に集約する。
function finalizeEvent(
  event: MobileEvent,
  hint: MobileHint,
): MobileEvent | null {
  if (shouldDropEvent(event, hint)) return null;
  event.tags = {
    ...event.tags,
    [TAG_KEYS.app]: "animeishi-mobile",
    [TAG_KEYS.runtime]: resolveRuntime(),
    [TAG_KEYS.platform]: Platform.OS,
    [TAG_KEYS.errorKind]: classifyEvent(event, hint),
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

// ユーザー・環境起因のイベントは issue にしない:
// - ApiRequestError の 4xx … 再ログインや入力修正で解決できるため送らない
//   （5xx はサーバー障害なので送る）
// - 通信断 … 端末のオフライン・タイムアウトはアプリ側で修復できない
function shouldDropEvent(event: MobileEvent, hint: MobileHint): boolean {
  const status = apiErrorStatus(hint.originalException);
  if (status !== null) return status < 500;
  const value = event.exception?.values?.[0];
  return isConnectivityError(value?.type ?? "", value?.value ?? "");
}

// exception のクラス名・メッセージ・HTTP ステータスから error.kind を推定する。
function classifyEvent(event: MobileEvent, hint: MobileHint): ErrorKind {
  const status = apiErrorStatus(hint.originalException);
  if (status !== null) {
    if (status === 401 || status === 403) return "auth";
    if (status >= 500) return "upstream";
    return "validation";
  }
  const value = event.exception?.values?.[0];
  const type = value?.type ?? "";
  const message = value?.value ?? "";
  if (type === "ZodError") return "validation";
  if (isConnectivityError(type, message)) return "upstream";
  if (/clerk|unauthorized/i.test(`${type} ${message}`)) return "auth";
  return "unknown";
}

// ApiRequestError の HTTP ステータスを取り出す。ホットリロード等で
// プロトタイプが剥がれる経路に備え、instanceof に加えて name/status でも判定する。
function apiErrorStatus(err: unknown): number | null {
  if (err instanceof ApiRequestError) return err.status;
  const e = err as { name?: unknown; status?: unknown } | null;
  if (e?.name === "ApiRequestError" && typeof e.status === "number") {
    return e.status;
  }
  return null;
}

// 端末側の通信断。Hermes は "Network request failed"、Web は
// "Failed to fetch" / "Load failed" / "NetworkError" が出る。
function isConnectivityError(type: string, message: string): boolean {
  if (type === "AbortError") return true;
  return /network request failed|failed to fetch|load failed|networkerror|timed? ?out|econn|aborted/i.test(
    `${type} ${message}`,
  );
}

function resolveRuntime(): string {
  if (Platform.OS === "web") return "browser";
  return (globalThis as { HermesInternal?: unknown }).HermesInternal
    ? "hermes"
    : "jsc";
}
