// Sentry 初期化オプションの組み立てと送信ポリシー（beforeSend）。
// observability.ts（ネイティブ）と observability.web.ts（Web）の
// 両方から使うため、@sentry/react-native は型だけを import する
// （値として import すると Web の遅延ロード対象が初回バンドルへ戻る）。
// 命名・sanitize のルールは @animeishi/observability（API と共有）を使い、
// 設計は docs/08_observability-design.md を参照。
import type * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import {
  buildRelease,
  resolveEnvironment,
  sanitizeHeaders,
  TAG_KEYS,
  type ErrorKind,
} from "@animeishi/observability";
import { ApiRequestError } from "@/lib/apiError";
import { resolveRuntime } from "@/lib/observabilityRuntime";

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
    // 構造化ログ（Sentry Logs）を有効化。Annict 連携ファネル計測（issue #64）
    // の送信先。enabled:false の環境ではクライアントごと no-op なので
    // ここは常に立ててよい。
    enableLogs: true,
    // ユーザー情報・IP・cookie などの PII は送らない。
    sendDefaultPii: false,
    beforeSend: (event, hint) => finalizeEvent(event, hint),
  };
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
